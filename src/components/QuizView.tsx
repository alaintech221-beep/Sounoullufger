import React, { useState, useEffect, useMemo } from 'react';
import { RoadSign, CategoryId, UserStats, MASTERY_LEVELS } from '../types/signs';
import { ROAD_SIGNS, CATEGORIES } from '../data/signs';
import { SignImage } from './SignImage';
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  RotateCcw,
  Trophy,
  Sparkles,
  HelpCircle,
  Lightbulb,
  ShieldCheck,
  Zap,
  GraduationCap,
  Clock,
  Timer,
  Check,
  AlertCircle,
  FileText,
} from 'lucide-react';
import {
  playCorrectSound,
  playWrongSound,
  playFanfareSound,
  playTapSound,
  triggerHaptic,
  speakFrench,
} from '../utils/audio';
import { getSignMasteryLevel, recordMultipleSignAnswers } from '../utils/storage';

interface QuizViewProps {
  stats: UserStats;
  onRecordAnswer: (signId: number, isCorrect: boolean) => void;
  onUpdateStats?: (newStats: UserStats) => void;
  onSaveQuizResult: (
    score: number,
    total: number,
    mode: 'standard' | 'marathon' | 'revision' | 'category' | 'examen',
    category?: CategoryId
  ) => void;
  onSwitchToRevision: () => void;
  presetCategory?: CategoryId;
  presetMode?: 'standard' | 'marathon' | 'revision' | 'category' | 'examen';
  presetSignIds?: number[];
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

export type QuizMode = 'standard' | 'marathon' | 'category' | 'revision' | 'examen';

export interface ExamAnswer {
  sign: RoadSign;
  userChoice: RoadSign | null;
  isCorrect: boolean;
  timedOut: boolean;
}

function getSignWeight(sign: RoadSign, stats: UserStats): number {
  const level = getSignMasteryLevel(stats.progressBySign[sign.id]);
  // Lower level signs (Nouveau: 8, En apprentissage: 5) are proposed significantly more often
  let weight = level === 0 ? 8 : level === 1 ? 5 : level === 2 ? 2 : 1;
  if (stats.mistakeIds.includes(sign.id)) {
    weight += 6;
  }
  return weight;
}

function selectWeightedQuizPool(candidates: RoadSign[], count: number, stats: UserStats): RoadSign[] {
  if (candidates.length <= count) {
    return [...candidates].sort((a, b) => {
      const wa = getSignWeight(a, stats);
      const wb = getSignWeight(b, stats);
      return wb - wa + (Math.random() - 0.5) * 1.5;
    });
  }

  const pool = [...candidates];
  const selected: RoadSign[] = [];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const weights = pool.map((s) => getSignWeight(s, stats));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);
    let rand = Math.random() * totalWeight;

    let chosenIdx = 0;
    for (let j = 0; j < pool.length; j++) {
      rand -= weights[j];
      if (rand <= 0) {
        chosenIdx = j;
        break;
      }
    }

    selected.push(pool[chosenIdx]);
    pool.splice(chosenIdx, 1);
  }

  return selected;
}

export const QuizView: React.FC<QuizViewProps> = ({
  stats,
  onRecordAnswer,
  onUpdateStats,
  onSaveQuizResult,
  onSwitchToRevision,
  presetCategory,
  presetMode,
  presetSignIds,
  soundEnabled,
  hapticsEnabled,
}) => {
  const [inQuiz, setInQuiz] = useState(false);
  const [quizPool, setQuizPool] = useState<RoadSign[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [currentChoices, setCurrentChoices] = useState<RoadSign[]>([]);
  const [quizFinished, setQuizFinished] = useState(false);
  const [sessionMistakes, setSessionMistakes] = useState<RoadSign[]>([]);
  const [activeMode, setActiveMode] = useState<QuizMode>('standard');
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>(presetCategory || 'danger');

  // Exam mode specific state
  const [examTimer, setExamTimer] = useState<number>(30);
  const [selectedExamChoice, setSelectedExamChoice] = useState<RoadSign | null>(null);
  const [examAnswers, setExamAnswers] = useState<ExamAnswer[]>([]);
  const [examFilter, setExamFilter] = useState<'mistakes' | 'all'>('mistakes');

  // Start a new quiz session with weighted selection favoring lower mastery levels
  const startQuiz = (mode: QuizMode, category?: CategoryId, specificIds?: number[]) => {
    setActiveMode(mode);
    let finalPool: RoadSign[] = [];

    if (mode === 'examen') {
      // 40 questions tirées au hasard dans tous les panneaux
      finalPool = [...ROAD_SIGNS].sort(() => 0.5 - Math.random()).slice(0, 40);
      setExamTimer(30);
      setSelectedExamChoice(null);
      setExamAnswers([]);
      setExamFilter('mistakes');
    } else if (mode === 'revision') {
      const idsToRevise = specificIds && specificIds.length > 0 ? specificIds : stats.mistakeIds;
      const signs = ROAD_SIGNS.filter((s) => idsToRevise.includes(s.id));
      finalPool = [...signs].sort((a, b) => {
        const lvlA = getSignMasteryLevel(stats.progressBySign[a.id]);
        const lvlB = getSignMasteryLevel(stats.progressBySign[b.id]);
        return lvlA - lvlB;
      });
    } else if (mode === 'category' && category) {
      const catSigns = ROAD_SIGNS.filter((s) => s.categorie === category);
      finalPool = selectWeightedQuizPool(catSigns, Math.min(10, catSigns.length), stats);
    } else if (mode === 'marathon') {
      finalPool = [...ROAD_SIGNS].sort((a, b) => {
        const wa = getSignWeight(a, stats);
        const wb = getSignWeight(b, stats);
        return wb - wa + (Math.random() - 0.5) * 2;
      });
    } else {
      // Standard 10 questions: heavily prioritize lower mastery levels (Nouveau, En apprentissage)
      finalPool = selectWeightedQuizPool(ROAD_SIGNS, 10, stats);
    }

    setQuizPool(finalPool);
    setCurrentIndex(0);
    setScore(0);
    setSessionMistakes([]);
    setQuizFinished(false);
    setSelectedChoiceId(null);
    setIsAnswered(false);
    setInQuiz(true);

    if (finalPool.length > 0) {
      setupQuestionChoices(finalPool[0]);
    }
  };

  // Auto start revision quiz if triggered with presetMode
  useEffect(() => {
    if (presetMode === 'revision' && (presetSignIds?.length || stats.mistakeIds.length > 0) && !inQuiz) {
      startQuiz('revision', undefined, presetSignIds);
    } else if (presetCategory && !inQuiz && presetMode === 'category') {
      setSelectedCategory(presetCategory);
      startQuiz('category', presetCategory);
    } else if (presetMode === 'examen' && !inQuiz) {
      startQuiz('examen');
    }
  }, [presetMode, presetCategory, presetSignIds]);

  // Exam 30 seconds countdown timer
  useEffect(() => {
    if (!inQuiz || activeMode !== 'examen' || quizFinished) return;

    const timer = setInterval(() => {
      setExamTimer((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [inQuiz, activeMode, quizFinished, currentIndex]);

  // Trigger timeout auto-submit when timer reaches 0 in exam mode
  useEffect(() => {
    if (inQuiz && activeMode === 'examen' && !quizFinished && examTimer === 0) {
      handleValidateExamChoice(selectedExamChoice, true);
    }
  }, [examTimer, inQuiz, activeMode, quizFinished, selectedExamChoice]);

  // Generate 4 options for a question (1 correct, 3 distractors)
  const setupQuestionChoices = (currentSign: RoadSign) => {
    const sameCatDistractors = ROAD_SIGNS.filter(
      (s) => s.id !== currentSign.id && s.categorie === currentSign.categorie
    );
    const otherDistractors = ROAD_SIGNS.filter(
      (s) => s.id !== currentSign.id && s.categorie !== currentSign.categorie
    );

    const shuffledSame = [...sameCatDistractors].sort(() => 0.5 - Math.random());
    const shuffledOther = [...otherDistractors].sort(() => 0.5 - Math.random());

    const chosenDistractors = [
      ...shuffledSame.slice(0, 2),
      ...shuffledOther.slice(0, 2),
    ].slice(0, 3);

    const allChoices = [currentSign, ...chosenDistractors].sort(() => 0.5 - Math.random());
    setCurrentChoices(allChoices);
  };

  // Standard Quiz Choice Selection (immediate reveal)
  const handleSelectChoice = (choice: RoadSign) => {
    if (isAnswered) return;

    const currentSign = quizPool[currentIndex];
    const isCorrect = choice.id === currentSign.id;

    setSelectedChoiceId(choice.id);
    setIsAnswered(true);

    if (isCorrect) {
      setScore((prev) => prev + 1);
      playCorrectSound(soundEnabled);
      triggerHaptic(hapticsEnabled, 'success');
      onRecordAnswer(currentSign.id, true);
    } else {
      playWrongSound(soundEnabled);
      triggerHaptic(hapticsEnabled, 'error');
      setSessionMistakes((prev) => [...prev, currentSign]);
      onRecordAnswer(currentSign.id, false);
    }
  };

  const handleNext = () => {
    playTapSound(soundEnabled);
    if (currentIndex + 1 < quizPool.length) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setSelectedChoiceId(null);
      setIsAnswered(false);
      setupQuestionChoices(quizPool[nextIndex]);
    } else {
      // Quiz completed!
      setQuizFinished(true);
      playFanfareSound(soundEnabled);
      onSaveQuizResult(
        score,
        quizPool.length,
        activeMode,
        activeMode === 'category' ? selectedCategory : undefined
      );
    }
  };

  // Examen Blanc Question Validation (no feedback during exam, only at the end)
  const handleValidateExamChoice = (choice: RoadSign | null, wasTimeout = false) => {
    const currentSign = quizPool[currentIndex];
    const isCorrect = choice ? choice.id === currentSign.id : false;

    playTapSound(soundEnabled);
    triggerHaptic(hapticsEnabled, isCorrect ? 'success' : 'error');

    const answerRecord: ExamAnswer = {
      sign: currentSign,
      userChoice: choice,
      isCorrect,
      timedOut: wasTimeout && !choice,
    };

    const newAnswers = [...examAnswers, answerRecord];
    setExamAnswers(newAnswers);

    if (isCorrect) {
      setScore((prev) => prev + 1);
    } else {
      setSessionMistakes((prev) => [...prev, currentSign]);
    }

    if (currentIndex + 1 < quizPool.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      setSelectedExamChoice(null);
      setExamTimer(30);
      setupQuestionChoices(quizPool[nextIdx]);
    } else {
      // Examen terminé !
      const finalScore = newAnswers.filter((a) => a.isCorrect).length;
      setQuizFinished(true);

      if (finalScore >= 35) {
        playFanfareSound(soundEnabled);
      } else {
        playWrongSound(soundEnabled);
      }

      // Mise à jour de la maîtrise et de la révision pour l'ensemble des 40 questions
      const batchUpdates = newAnswers.map((a) => ({
        signId: a.sign.id,
        isCorrect: a.isCorrect,
      }));
      const updatedStats = recordMultipleSignAnswers(batchUpdates);
      if (onUpdateStats) {
        onUpdateStats(updatedStats);
      }

      onSaveQuizResult(finalScore, 40, 'examen');
    }
  };

  const currentSign = quizPool[currentIndex];
  const progressPercent = quizPool.length > 0 ? (currentIndex / quizPool.length) * 100 : 0;
  const examTimerPercent = (examTimer / 30) * 100;

  // Render Start Screen if not in quiz
  if (!inQuiz) {
    return (
      <div className="space-y-4">
        {/* Featured Examen Blanc Card */}
        <div className="p-6 rounded-3xl bg-gradient-to-br from-indigo-700 via-blue-700 to-sky-700 text-white shadow-xl shadow-blue-600/20 relative overflow-hidden">
          <div className="relative z-10 space-y-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-white/20 text-white backdrop-blur-md flex items-center gap-1.5 shadow-xs">
                <GraduationCap className="w-4 h-4 text-amber-300" />
                <span>Examen Blanc Officiel</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>30s / question</span>
              </span>
            </div>

            <div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
                Épreuve 40 Questions
              </h2>
              <p className="mt-1.5 text-xs sm:text-sm text-blue-100 max-w-lg leading-relaxed">
                Testez-vous dans les <strong>conditions réelles de l'examen</strong> : 40 questions chronométrées tirées parmi tous les panneaux. Aucune correction pendant le test, score sur 40 et correction complète détaillée à la fin.
              </p>
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  playTapSound(soundEnabled);
                  startQuiz('examen');
                }}
                className="py-3 px-5 rounded-2xl bg-white hover:bg-blue-50 text-slate-900 font-extrabold text-xs sm:text-sm shadow-lg shadow-black/10 transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <GraduationCap className="w-4 h-4 text-blue-600" />
                <span>Démarrer l'Examen Blanc (40 Q) →</span>
              </button>
              <span className="text-[11px] text-blue-200">
                Seuil de réussite : <strong>35 / 40</strong> (max 5 fautes)
              </span>
            </div>
          </div>
          <div className="absolute -right-8 -bottom-8 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        </div>

        {/* Standard Training Modes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Mode 1: Express 10 questions */}
          <button
            onClick={() => {
              playTapSound(soundEnabled);
              startQuiz('standard');
            }}
            className="flex flex-col items-start p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 transition-all text-left group active:scale-[0.98] shadow-sm cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Quiz Express
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              10 questions rapides avec priorité à vos erreurs récentes.
            </p>
            <span className="mt-3 text-xs font-semibold text-blue-600 dark:text-blue-400">
              Lancer 10 QCM →
            </span>
          </button>

          {/* Mode 2: Marathon tous les panneaux */}
          <button
            onClick={() => {
              playTapSound(soundEnabled);
              startQuiz('marathon');
            }}
            className="flex flex-col items-start p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 transition-all text-left group active:scale-[0.98] shadow-sm cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Trophy className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Grand Chelem
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Les {ROAD_SIGNS.length} panneaux du programme complet sans exception.
            </p>
            <span className="mt-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              Lancer {ROAD_SIGNS.length} QCM →
            </span>
          </button>

          {/* Mode 3: Par catégorie */}
          <div className="flex flex-col items-start p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Par Catégorie
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">
              Travaillez une famille de panneaux spécifique.
            </p>
            <div className="w-full flex gap-1 mt-auto">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as CategoryId)}
                className="flex-1 py-1.5 px-2 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none"
              >
                {Object.keys(CATEGORIES).map((catKey) => {
                  const catId = catKey as CategoryId;
                  const count = ROAD_SIGNS.filter((s) => s.categorie === catId).length;
                  if (count === 0) return null;
                  return (
                    <option key={catId} value={catId}>
                      {CATEGORIES[catId].name} ({count})
                    </option>
                  );
                })}
              </select>
              <button
                onClick={() => {
                  playTapSound(soundEnabled);
                  startQuiz('category', selectedCategory);
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                Go
              </button>
            </div>
          </div>
        </div>

        {/* If user has mistakes, show revision banner */}
        {stats.mistakeIds.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-400 gap-3">
            <div className="flex items-center gap-3">
              <RotateCcw className="w-5 h-5 shrink-0" />
              <div>
                <p className="text-xs sm:text-sm font-bold">
                  {stats.mistakeIds.length} panneau{stats.mistakeIds.length > 1 ? 'x' : ''} en cours de révision
                </p>
                <p className="text-[11px] text-rose-400/80">
                  2 bonnes réponses d'affilée pour les valider. Niveaux bas prioritaires.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                onClick={() => {
                  playTapSound(soundEnabled);
                  startQuiz('revision');
                }}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shrink-0 transition-colors shadow-sm cursor-pointer"
              >
                Quiz Révision ({stats.mistakeIds.length})
              </button>
              <button
                onClick={onSwitchToRevision}
                className="px-3 py-2 rounded-xl bg-white/60 dark:bg-slate-800 text-rose-600 dark:text-rose-300 text-xs font-bold shrink-0 transition-colors border border-rose-300 dark:border-rose-900 cursor-pointer"
              >
                Voir fiches
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render Finished Summary Screen for EXAMEN BLANC
  if (quizFinished && activeMode === 'examen') {
    const total = 40;
    const ratio = total > 0 ? score / total : 0;
    const percentage = Math.round(ratio * 100);
    const mistakesCount = total - score;
    const isPassed = score >= 35;

    const displayedAnswers =
      examFilter === 'mistakes'
        ? examAnswers.filter((a) => !a.isCorrect)
        : examAnswers;

    return (
      <div className="max-w-xl mx-auto space-y-5 animate-scale-up">
        {/* Main Verdict Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            <GraduationCap className="w-4 h-4 text-blue-500" />
            <span>Résultat de l'Examen Blanc</span>
          </div>

          {/* Big Score Ring */}
          <div className="relative w-36 h-36 mx-auto flex items-center justify-center">
            <svg className="w-full h-full -rotate-90">
              <circle
                cx="72"
                cy="72"
                r="60"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                className="text-slate-100 dark:text-slate-800"
              />
              <circle
                cx="72"
                cy="72"
                r="60"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                strokeDasharray={2 * Math.PI * 60}
                strokeDashoffset={2 * Math.PI * 60 * (1 - ratio)}
                strokeLinecap="round"
                className={isPassed ? 'text-emerald-500' : score >= 30 ? 'text-amber-500' : 'text-rose-500'}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">
                {score}/40
              </span>
              <span className="text-xs font-semibold text-slate-400">{percentage}%</span>
            </div>
          </div>

          <div>
            <div className="inline-block px-3 py-1 rounded-full text-xs font-extrabold uppercase mb-2"
              style={{
                backgroundColor: isPassed ? '#10b98120' : score >= 30 ? '#f59e0b20' : '#f43f5e20',
                color: isPassed ? '#10b981' : score >= 30 ? '#f59e0b' : '#f43f5e',
              }}
            >
              {isPassed ? '✓ ADMIS À L\'EXAMEN' : '✗ NON ADMIS (SEUIL : 35/40)'}
            </div>

            <h2 className={`text-xl font-black ${isPassed ? 'text-emerald-600 dark:text-emerald-400' : score >= 30 ? 'text-amber-500' : 'text-rose-500'}`}>
              {isPassed
                ? 'Félicitations, examen réussi ! 🎉'
                : score >= 30
                ? 'Presque réussi ! Continuez vos efforts 💪'
                : 'Examen ajourné : révisions nécessaires 📖'}
            </h2>

            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto leading-relaxed">
              {isPassed
                ? `Vous avez obtenu ${score}/40 avec seulement ${mistakesCount} faute${mistakesCount > 1 ? 's' : ''}. Vous seriez reçu(e) à l'épreuve officielle du code de la route !`
                : score >= 30
                ? `Vous avez commis ${mistakesCount} fautes. L'examen officiel tolère au maximum 5 erreurs (35/40). Consultez vos erreurs ci-dessous pour combler vos lacunes.`
                : `Vous avez commis ${mistakesCount} erreurs sur 40 questions. Tous les panneaux ratés ont été automatiquement ajoutés à vos Révisions.`}
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
              <span className="block text-xl font-black tabular-nums">{score}</span>
              <span>Bonnes réponses</span>
            </div>
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 font-bold">
              <span className="block text-xl font-black tabular-nums">{mistakesCount}</span>
              <span>Erreurs commises</span>
            </div>
          </div>

          {/* Navigation Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            {mistakesCount > 0 && (
              <button
                onClick={() => {
                  playTapSound(soundEnabled);
                  onSwitchToRevision();
                }}
                className="py-3 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Réviser ({mistakesCount})</span>
              </button>
            )}

            <button
              onClick={() => {
                playTapSound(soundEnabled);
                startQuiz('examen');
              }}
              className="py-3 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            >
              <GraduationCap className="w-4 h-4" />
              <span>Nouvel Examen</span>
            </button>

            <button
              onClick={() => {
                playTapSound(soundEnabled);
                setInQuiz(false);
              }}
              className={`py-3 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer ${
                mistakesCount === 0 ? 'sm:col-span-2' : ''
              }`}
            >
              Menu principal
            </button>
          </div>
        </div>

        {/* Detailed Correction Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span>Correction détaillée</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Chaque erreur est analysée avec le visuel, la bonne réponse et la règle
              </p>
            </div>

            {/* Filter Toggle */}
            <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start sm:self-auto text-xs">
              <button
                onClick={() => setExamFilter('mistakes')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  examFilter === 'mistakes'
                    ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Erreurs ({mistakesCount})
              </button>
              <button
                onClick={() => setExamFilter('all')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  examFilter === 'all'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Toutes (40)
              </button>
            </div>
          </div>

          {displayedAnswers.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="font-bold text-sm text-slate-800 dark:text-slate-200">
                Aucune erreur à afficher !
              </p>
              <p className="mt-1">Vous avez répondu correctement à toutes les questions.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {displayedAnswers.map((item, idx) => {
                const questionNumber = examAnswers.findIndex((a) => a.sign.id === item.sign.id) + 1;
                return (
                  <div
                    key={`${item.sign.id}_${idx}`}
                    className={`p-4 rounded-2xl border text-left space-y-3 transition-colors ${
                      item.isCorrect
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/40'
                        : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-400">
                          Q{questionNumber > 0 ? questionNumber : idx + 1}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${
                            CATEGORIES[item.sign.categorie]?.bgColor || 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {CATEGORIES[item.sign.categorie]?.name || item.sign.categorie}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                          {item.sign.code}
                        </span>
                      </div>

                      {item.isCorrect ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Exact</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2.5 py-0.5 rounded-full border border-rose-500/20">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Erreur</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3.5">
                      <div className="w-16 h-16 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 flex items-center justify-center shrink-0 shadow-2xs">
                        <SignImage sign={item.sign} imageClassName="w-14 h-14 object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                          {item.sign.nom}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                          {item.sign.signification}
                        </p>
                      </div>
                    </div>

                    {/* Answers Comparison */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div
                        className={`p-2.5 rounded-xl border ${
                          item.isCorrect
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        <span className="block font-bold text-[10px] uppercase opacity-75">
                          Votre réponse :
                        </span>
                        <span className="font-semibold">
                          {item.timedOut
                            ? '⏱️ Temps écoulé (aucune réponse validée)'
                            : item.userChoice?.nom || 'Non répondu'}
                        </span>
                      </div>

                      {!item.isCorrect && (
                        <div className="p-2.5 rounded-xl border bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                          <span className="block font-bold text-[10px] uppercase opacity-75">
                            Bonne réponse :
                          </span>
                          <span className="font-semibold">{item.sign.nom}</span>
                        </div>
                      )}
                    </div>

                    {/* Explanation & Rule */}
                    <div className="p-3 rounded-xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                      <p>
                        <strong className="text-slate-800 dark:text-slate-200">Règle officielle :</strong>{' '}
                        {item.sign.regle}
                      </p>
                      {item.sign.astuce && (
                        <p className="text-amber-600 dark:text-amber-400 flex items-start gap-1 pt-0.5">
                          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>
                            <strong>Astuce mémo :</strong> {item.sign.astuce}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render Finished Summary Screen for STANDARD / MARATHON / CATEGORY / REVISION
  if (quizFinished) {
    const total = quizPool.length;
    const ratio = total > 0 ? score / total : 0;
    const percentage = Math.round(ratio * 100);

    let feedbackTitle = 'Bon travail !';
    let feedbackColor = 'text-blue-500';
    if (ratio === 1) {
      feedbackTitle = 'Score Parfait ! 🏆';
      feedbackColor = 'text-emerald-500';
    } else if (ratio >= 0.8) {
      feedbackTitle = 'Excellente maîtrise !';
      feedbackColor = 'text-emerald-500';
    } else if (ratio < 0.5) {
      feedbackTitle = 'Besoin de révision';
      feedbackColor = 'text-rose-500';
    }

    return (
      <div className="max-w-lg mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl text-center space-y-5 animate-scale-up">
        {/* Score Ring */}
        <div className="relative w-32 h-32 mx-auto flex items-center justify-center">
          <svg className="w-full h-full -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              className="text-slate-100 dark:text-slate-800"
            />
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              strokeDasharray={2 * Math.PI * 54}
              strokeDashoffset={2 * Math.PI * 54 * (1 - ratio)}
              strokeLinecap="round"
              className={ratio >= 0.7 ? 'text-emerald-500' : 'text-blue-500'}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">
              {score}/{total}
            </span>
            <span className="text-xs font-semibold text-slate-400">{percentage}%</span>
          </div>
        </div>

        <div>
          <h2 className={`text-xl font-black ${feedbackColor}`}>{feedbackTitle}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {sessionMistakes.length === 0
              ? 'Aucune erreur commise sur cette série, félicitations !'
              : `${sessionMistakes.length} panneau(x) ont été ajoutés à vos révisions prioritaires.`}
          </p>
        </div>

        {/* Mistakes Review if any */}
        {sessionMistakes.length > 0 && (
          <div className="text-left bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2.5">
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5 text-rose-500" />
              <span>Panneaux à revoir ({sessionMistakes.length}) :</span>
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {sessionMistakes.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <div className="w-10 h-10 shrink-0 flex items-center justify-center p-1">
                    <SignImage sign={m} imageClassName="w-8 h-8 object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white truncate">{m.nom}</p>
                    <p className="text-[11px] text-slate-500 truncate">{m.signification}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
          {sessionMistakes.length > 0 && (
            <button
              onClick={() => {
                playTapSound(soundEnabled);
                onSwitchToRevision();
              }}
              className="py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Réviser les erreurs</span>
            </button>
          )}

          <button
            onClick={() => {
              playTapSound(soundEnabled);
              startQuiz(activeMode, selectedCategory);
            }}
            className="py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>Nouveau Quiz</span>
          </button>

          <button
            onClick={() => {
              playTapSound(soundEnabled);
              setInQuiz(false);
            }}
            className="py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors sm:col-span-2 cursor-pointer"
          >
            Retour au menu
          </button>
        </div>
      </div>
    );
  }

  // Active EXAMEN BLANC Question View (timed 30s, no immediate correction, validation button)
  if (activeMode === 'examen') {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        {/* Exam Header */}
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <button
            onClick={() => {
              playTapSound(soundEnabled);
              setInQuiz(false);
            }}
            className="hover:text-slate-700 dark:hover:text-slate-200 font-semibold cursor-pointer"
          >
            ← Quitter l'examen
          </button>

          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
              Question {currentIndex + 1} / {quizPool.length}
            </span>
          </div>

          {/* Countdown Clock Badge */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border transition-colors ${
              examTimer > 10
                ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                : examTimer > 5
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                : 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400 animate-pulse'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{examTimer}s</span>
          </div>
        </div>

        {/* Visible 30s Timer Bar */}
        <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden shadow-inner">
          <div
            className={`h-full transition-all duration-300 ease-linear rounded-full ${
              examTimer > 10
                ? 'bg-blue-600'
                : examTimer > 5
                ? 'bg-amber-500'
                : 'bg-rose-500 animate-pulse'
            }`}
            style={{ width: `${examTimerPercent}%` }}
          />
        </div>

        {/* Question Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm text-center">
          {/* Category & Exam Badge */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <span
              className={`inline-block text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full ${
                CATEGORIES[currentSign.categorie]?.bgColor || 'bg-slate-100 text-slate-600'
              }`}
            >
              {CATEGORIES[currentSign.categorie]?.name || currentSign.categorie}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Examen Blanc</span>
            </span>
          </div>

          {/* Big Sign Image */}
          <div className="w-40 h-40 mx-auto my-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 flex items-center justify-center filter drop-shadow-md">
            <SignImage sign={currentSign} imageClassName="w-32 h-32 object-contain filter drop-shadow-md" />
          </div>

          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 mt-2 mb-4">
            Quel est le nom ou la signification de ce panneau ?
          </p>

          {/* 4 Choices (Neutral, no correction revealed) */}
          <div className="space-y-2.5">
            {currentChoices.map((choice) => {
              const isSelected = selectedExamChoice?.id === choice.id;
              return (
                <button
                  key={choice.id}
                  onClick={() => {
                    playTapSound(soundEnabled);
                    setSelectedExamChoice(choice);
                  }}
                  className={`w-full min-h-[52px] p-3.5 rounded-2xl border text-left font-semibold text-sm transition-all duration-150 flex items-center justify-between gap-3 active:scale-[0.99] cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600/15 border-blue-500 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/30 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-100 hover:border-blue-400'
                  }`}
                >
                  <span className="leading-snug">{choice.nom}</span>
                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-500 text-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Validation Button (Bottom of card) */}
          <div className="pt-4 mt-2 border-t border-slate-100 dark:border-slate-800/80">
            <button
              onClick={() => handleValidateExamChoice(selectedExamChoice)}
              disabled={!selectedExamChoice}
              className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 cursor-pointer ${
                selectedExamChoice
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
              }`}
            >
              <span>
                {currentIndex + 1 < quizPool.length
                  ? 'Valider la réponse →'
                  : "Valider et terminer l'examen →"}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
            {!selectedExamChoice && (
              <p className="text-[11px] text-slate-400 mt-2">
                Sélectionnez une option pour valider, ou attendez la fin des 30 secondes.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active STANDARD / MARATHON / CATEGORY / REVISION Question View
  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* Quiz Progress & Abort header */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <button
          onClick={() => {
            playTapSound(soundEnabled);
            setInQuiz(false);
          }}
          className="hover:text-slate-700 dark:hover:text-slate-200 font-semibold cursor-pointer"
        >
          ← Quitter le quiz
        </button>

        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
            {currentIndex + 1} / {quizPool.length}
          </span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span className="text-emerald-500 font-bold tabular-nums">
            {score} pts
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className="h-full bg-blue-600 transition-all duration-300 ease-out rounded-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Main Question Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm text-center">
        {/* Category & Mastery Badge */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <span
            className={`inline-block text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full ${
              CATEGORIES[currentSign.categorie]?.bgColor || 'bg-slate-100 text-slate-600'
            }`}
          >
            {CATEGORIES[currentSign.categorie]?.name || currentSign.categorie}
          </span>
          {(() => {
            const currentLevel = getSignMasteryLevel(stats.progressBySign[currentSign.id]);
            const conf = MASTERY_LEVELS[currentLevel];
            return (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border"
                style={{
                  backgroundColor: `${conf.color}18`,
                  borderColor: `${conf.color}40`,
                  color: conf.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: conf.color }}
                />
                <span>{conf.label}</span>
              </span>
            );
          })()}
        </div>

        {/* Big Road Sign Image Preview */}
        <div className="w-40 h-40 mx-auto my-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 flex items-center justify-center filter drop-shadow-md">
          <SignImage
            sign={currentSign}
            imageClassName="w-32 h-32 object-contain filter drop-shadow-md"
          />
        </div>

        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 mt-2 mb-4">
          Quel est le nom ou la signification de ce panneau ?
        </p>

        {/* 4 Choices Big Mobile Buttons */}
        <div className="space-y-2.5">
          {currentChoices.map((choice) => {
            const isSelected = selectedChoiceId === choice.id;
            const isCorrect = choice.id === currentSign.id;

            let buttonStyle =
              'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-100 hover:border-blue-400';

            if (isAnswered) {
              if (isCorrect) {
                buttonStyle =
                  'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/30';
              } else if (isSelected && !isCorrect) {
                buttonStyle =
                  'bg-rose-500/15 border-rose-500 text-rose-700 dark:text-rose-300';
              } else {
                buttonStyle = 'opacity-40 border-slate-200 dark:border-slate-800 text-slate-400';
              }
            }

            return (
              <button
                key={choice.id}
                disabled={isAnswered}
                onClick={() => handleSelectChoice(choice)}
                className={`w-full min-h-[52px] p-3.5 rounded-2xl border text-left font-semibold text-sm transition-all duration-150 flex items-center justify-between gap-3 active:scale-[0.99] cursor-pointer ${buttonStyle}`}
              >
                <span className="leading-snug">{choice.nom}</span>
                {isAnswered && isCorrect && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                )}
                {isAnswered && isSelected && !isCorrect && (
                  <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Instant Explanation Feedback Sheet */}
        {isAnswered && (
          <div className="mt-5 text-left p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 animate-slide-up space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {selectedChoiceId === currentSign.id ? (
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Exact ! Niveau +1</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold text-sm">
                  <XCircle className="w-4 h-4" />
                  <span>Faux ! Niveau -1 · C'était : {currentSign.nom}</span>
                </div>
              )}
              {(() => {
                const currentLevel = getSignMasteryLevel(stats.progressBySign[currentSign.id]);
                const conf = MASTERY_LEVELS[currentLevel];
                return (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold"
                    style={{
                      backgroundColor: `${conf.color}15`,
                      color: conf.color,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: conf.color }}
                    />
                    <span>Nouveau statut : {conf.label}</span>
                  </span>
                );
              })()}
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              <strong>Signification :</strong> {currentSign.signification}
            </p>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <strong>Règle :</strong> {currentSign.regle}
            </p>

            {currentSign.astuce && (
              <div className="flex items-start gap-1.5 pt-1 text-xs text-amber-600 dark:text-amber-400">
                <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Astuce :</strong> {currentSign.astuce}
                </span>
              </div>
            )}

            {/* Next Button */}
            <button
              onClick={handleNext}
              className="mt-3 w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <span>
                {currentIndex + 1 < quizPool.length ? 'Question suivante' : 'Voir les résultats'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
