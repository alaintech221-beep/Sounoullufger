import React, { useState } from 'react';
import {
  Info,
  X,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Heart,
  Scale,
  FileCheck2,
  Trash2,
} from 'lucide-react';
import { playTapSound } from '../utils/audio';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetStats: () => void;
  soundEnabled: boolean;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  onResetStats,
  soundEnabled,
}) => {
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  if (!isOpen) return null;

  const handleReset = () => {
    playTapSound(soundEnabled);
    onResetStats();
    setShowConfirmReset(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-lg max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl overflow-y-auto text-slate-900 dark:text-white z-10 animate-scale-up space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-600/15 border border-blue-500/30 p-2 flex items-center justify-center shrink-0">
              <img
                src="/icon.svg"
                alt="Logo SignaGo"
                draggable={false}
                className="w-full h-full object-contain pointer-events-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black tracking-tight">SignaGo</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  v1.3
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Panneaux & Signaux du Code de la Route
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              playTapSound(soundEnabled);
              onClose();
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section 1: Avertissement & Nature de l'outil */}
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 space-y-1.5 text-xs">
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Outil d'entraînement non officiel</span>
          </div>
          <p className="leading-relaxed">
            Cette application est un <strong>outil d'entraînement et de révision indépendant</strong> qui ne remplace pas le code de la route officiel, ni les cours et examens dispensés par une école de conduite agréée.
          </p>
        </div>

        {/* Section 2: Périmètre des panneaux */}
        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <FileCheck2 className="w-4 h-4 text-blue-500 shrink-0" />
            <span>Panneaux du Code de la route français</span>
          </div>
          <p className="leading-relaxed">
            Tous les panneaux, panonceaux, marquages au sol, feux tricolores et signaux d'agents intégrés sont strictement ceux de la réglementation française, conformes à l'<strong>Instruction Interministérielle sur la Signalisation Routière (IISR)</strong> et aux arrêtés officiels en vigueur.
          </p>
        </div>

        {/* Section 3: Crédits des images */}
        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800/80 pt-4">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <Scale className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Crédits & Licences des images</span>
          </div>
          <p className="leading-relaxed">
            Les visuels vectoriels et photographiques des panneaux proviennent de la médiathèque libre <strong>Wikimedia Commons</strong>, sous licences libres (Creative Commons CC BY-SA et Domaine Public).
          </p>
          <a
            href="https://commons.wikimedia.org/wiki/Commons:Licensing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline font-semibold"
          >
            <span>Consulter la page de licence Wikimedia Commons</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Section 4: Réinitialisation de la progression */}
        <div className="border-t border-slate-100 dark:border-slate-800/80 pt-4 space-y-3">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-500" />
            <span>Gestion des données de progression</span>
          </h4>

          {!showConfirmReset ? (
            <button
              onClick={() => {
                playTapSound(soundEnabled);
                setShowConfirmReset(true);
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Réinitialiser la progression</span>
            </button>
          ) : (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 space-y-3">
              <p className="text-xs font-bold text-center">
                Voulez-vous vraiment effacer toute votre progression (scores, niveaux de maîtrise et historique des examens) ?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirmReset(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
                >
                  Confirmer
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={() => {
            playTapSound(soundEnabled);
            onClose();
          }}
          className="w-full py-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-colors"
        >
          Fermer
        </button>
      </div>
    </div>
  );
};
