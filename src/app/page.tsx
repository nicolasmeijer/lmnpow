"use client";

import { useState, useMemo, useEffect, Fragment } from "react";

interface BienImmobilier {
  montantAchat: string;
  dureeAmortissement: string;
  premiereAnneeExercice: string;
  datePremiereMiseEnLocation: string;
}

interface Depense {
  id: number;
  annee: string;
  type: string;
  montant: string;
  commentaire: string;
}

interface LoyerPercu {
  id: number;
  exercice: string;
  nombreMois: string;
  loyerMensuel: string;
}

interface Pret {
  id: number;
  montant: string;
  dateDebut: string;
  duree: string;
  jourEcheance: string;
  taux: string;
  fraisDivers: string;
  differeJusquaPretId: string; // "" = pas de différé, sinon id du prêt de référence
}

interface LigneAmortissementPret {
  numero: number;
  date: string;
  amortissement: number;
  interets: number;
  fraisDivers: number;
  echeance: number;
  capitalRestant: number;
  isDiffere: boolean;
}

interface LigneAmortissement {
  annee: number;
  numeroExercice: number;
  debutPeriode: number;
  amortissementPeriode: number;
  finPeriode: number;
}

interface ActifLigne { brut: string; amort: string; }
interface ImmoLigne { debut: string; aug: string; dim: string; reeval: string; }

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

function proRataPremierAnnee(dateLocation: Date, annee: number): number {
  // Nombre de jours depuis la date de mise en location jusqu'au 31/12 inclus
  const finAnnee = new Date(annee, 11, 31);
  const debutAnnee = new Date(annee, 0, 1);
  const totalJours = daysInYear(annee);
  // Jours de location dans l'année = du jour de mise en location au 31/12
  const joursLocation =
    Math.floor((finAnnee.getTime() - dateLocation.getTime()) / 86400000) + 1;
  const jours = Math.max(0, Math.min(joursLocation, totalJours));
  // Vérification cohérence : la date de location doit être dans l'année
  const jourDebutAnnee = Math.floor(
    (dateLocation.getTime() - debutAnnee.getTime()) / 86400000
  );
  if (jourDebutAnnee < 0) return 1; // date avant l'année → toute l'année
  return jours / totalJours;
}

function calculerAmortissements(
  montantAchat: number,
  duree: number,
  premiereAnnee: number,
  dateLocation: Date
): LigneAmortissement[] {
  const amortAnnuel = montantAchat / duree;

  // Pro rata première année (jours de location / jours dans l'année)
  const proRata = proRataPremierAnnee(dateLocation, premiereAnnee);
  const isProRataPlein = Math.abs(proRata - 1) < 0.0001;

  const lignes: LigneAmortissement[] = [];
  let cumul = 0;
  let exercice = 1;
  let annee = premiereAnnee;

  if (isProRataPlein) {
    // Pas de pro rata : exactement `duree` lignes, toutes pleines
    for (let i = 0; i < duree; i++) {
      const amort = amortAnnuel;
      lignes.push({
        annee,
        numeroExercice: exercice,
        debutPeriode: cumul,
        amortissementPeriode: amort,
        finPeriode: cumul + amort,
      });
      cumul += amort;
      annee++;
      exercice++;
    }
  } else {
    // Première année partielle
    const amortPremiere = amortAnnuel * proRata;
    lignes.push({
      annee,
      numeroExercice: exercice,
      debutPeriode: cumul,
      amortissementPeriode: amortPremiere,
      finPeriode: cumul + amortPremiere,
    });
    cumul += amortPremiere;
    annee++;
    exercice++;

    // Années pleines intermédiaires (duree - 1 années pleines)
    for (let i = 0; i < duree - 1; i++) {
      lignes.push({
        annee,
        numeroExercice: exercice,
        debutPeriode: cumul,
        amortissementPeriode: amortAnnuel,
        finPeriode: cumul + amortAnnuel,
      });
      cumul += amortAnnuel;
      annee++;
      exercice++;
    }

    // Dernière année partielle (complément du pro rata)
    const amortDerniere = amortAnnuel * (1 - proRata);
    if (amortDerniere > 0.01) {
      lignes.push({
        annee,
        numeroExercice: exercice,
        debutPeriode: cumul,
        amortissementPeriode: amortDerniere,
        finPeriode: cumul + amortDerniere,
      });
    }
  }

  return lignes;
}

function echeanceDatePret(startY: number, startM: number, jourEcheance: number, i: number): Date {
  const totalMois = startM - 1 + i;
  return new Date(startY + Math.floor(totalMois / 12), (totalMois % 12), jourEcheance);
}

function calculerAmortissementPret(pret: Pret, dateFinDiffere?: Date | null): LigneAmortissementPret[] {
  const capital = parseFloat(pret.montant);
  const tauxAnnuel = parseFloat(pret.taux) / 100;
  const dureeAns = parseFloat(pret.duree);
  const fraisMensuels = parseFloat(pret.fraisDivers) || 0;
  const jourEcheance = parseInt(pret.jourEcheance) || 10;
  const [startY, startM] = pret.dateDebut.split("-").map(Number);

  if (!capital || !tauxAnnuel || !dureeAns) return [];

  // n = nombre de mensualités d'amortissement normales (durée contractuelle du prêt)
  const n = Math.round(dureeAns * 12);
  const r = tauxAnnuel / 12;

  // Compter les périodes en différé : toutes les échéances tombant avant (ou le jour de)
  // la dernière échéance du prêt de référence, dans la limite de la durée contractuelle.
  let nDiffere = 0;
  if (dateFinDiffere) {
    for (let i = 1; i < n; i++) { // au moins 1 période normale doit rester
      if (echeanceDatePret(startY, startM, jourEcheance, i) <= dateFinDiffere) nDiffere++;
      else break;
    }
  }

  // La durée totale reste n mois. Le différé réduit la fenêtre d'amortissement.
  // Exemple : prêt 2 de 25 ans, différé 15 ans → amortissement sur 10 ans.
  const nNormal = n - nDiffere;
  const mensualite = r === 0 ? capital / nNormal : (capital * r) / (1 - Math.pow(1 + r, -nNormal));

  const lignes: LigneAmortissementPret[] = [];
  let capitalRestant = capital;
  const totalEcheances = n; // inchangé : n mois au total

  for (let i = 1; i <= totalEcheances; i++) {
    const totalMois = startM - 1 + i;
    const anneeEch = startY + Math.floor(totalMois / 12);
    const moisEch = (totalMois % 12) + 1;
    const dateStr = `${anneeEch}-${String(moisEch).padStart(2, "0")}-${String(jourEcheance).padStart(2, "0")}`;
    const interets = capitalRestant * r;
    const isDiffere = i <= nDiffere;

    if (isDiffere) {
      // Période en différé : intérêts seulement, capital inchangé
      lignes.push({
        numero: i, date: dateStr,
        amortissement: 0,
        interets: Math.round(interets * 100) / 100,
        fraisDivers: fraisMensuels,
        echeance: Math.round((interets + fraisMensuels) * 100) / 100,
        capitalRestant: Math.round(capitalRestant * 100) / 100,
        isDiffere: true,
      });
    } else {
      // Période normale : annuité constante sur n mois
      const amortissement = mensualite - interets;
      const nouveauCapital = Math.max(0, capitalRestant - amortissement);
      lignes.push({
        numero: i, date: dateStr,
        amortissement: Math.round(amortissement * 100) / 100,
        interets: Math.round(interets * 100) / 100,
        fraisDivers: fraisMensuels,
        echeance: Math.round((mensualite + fraisMensuels) * 100) / 100,
        capitalRestant: Math.round(nouveauCapital * 100) / 100,
        isDiffere: false,
      });
      capitalRestant = nouveauCapital;
    }
  }

  return lignes;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function formatEur(val: number): string {
  return val.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

/* ═══════════════════════════════════════════
   Composants UI des formulaires fiscaux
═══════════════════════════════════════════ */

function EnTeteFormulaire({ titre, numero }: { titre: string; numero: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
      {/* Bloc République Française */}
      <div className="flex items-start gap-2 shrink-0">
        {/* Drapeau tricolore miniature */}
        <div className="flex h-10 w-7 rounded-sm overflow-hidden shrink-0 mt-0.5 border border-slate-200">
          <div className="flex-1 bg-[#002395]" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-[#ED2939]" />
        </div>
        <div className="leading-tight text-[11px]">
          <div className="font-bold text-slate-800">RÉPUBLIQUE</div>
          <div className="font-bold text-slate-800">FRANÇAISE</div>
          <div className="text-slate-500 italic mt-0.5">Liberté<br />Égalité<br />Fraternité</div>
        </div>
      </div>

      {/* Titre central */}
      <div className="text-center flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Direction générale des finances publiques
        </div>
        <div className="text-base font-semibold text-slate-800 mt-1">{titre}</div>
      </div>

      {/* Numéro formulaire */}
      <div className="text-right shrink-0">
        <div className="text-xl font-bold text-slate-700">{numero}</div>
        <div className="text-[10px] text-slate-400 italic mt-0.5">(Applicable au 31/12/2025)</div>
      </div>
    </div>
  );
}

function BanniereNeant() {
  return (
    <div className="mx-6 my-4 flex items-center justify-between gap-4 border border-[#c8b87a] bg-[#fdf6dc] px-4 py-2.5 rounded">
      <span className="text-[12px] text-slate-700">
        Si vous n'avez à remplir aucune case de ce formulaire (formulaire « néant »), veuillez cocher la case
      </span>
      <input type="checkbox" className="w-4 h-4 shrink-0 border border-slate-400" />
    </div>
  );
}

/** En-tête d'un bloc de tableau (bande bleue) */
function EnteteBloc({ label, colonne = "Exercice N" }: { label: string; colonne?: string }) {
  return (
    <div className="flex items-center justify-between bg-[#1a4f72] text-white font-bold text-[11px] px-4 py-2 uppercase tracking-wide">
      <span>{label}</span>
      <span className="text-right">{colonne}</span>
    </div>
  );
}

/** Titre de section (texte bleu, pas de fond) */
function TitreSection({ label }: { label: string }) {
  return (
    <div className="px-4 pt-4 pb-1">
      <span className="font-bold text-[#1a4f72] uppercase text-[12px] tracking-wide">{label}</span>
    </div>
  );
}

/** Ligne standard : libellé + champ */
function LigneFormulaire({
  label,
  sous,
  valeur,
  gras,
  indent = 0,
}: {
  label: string;
  sous?: string;
  valeur?: string | number;
  gras?: boolean;
  indent?: number;
}) {
  const paddingLeft = `${1 + indent * 1.5}rem`;
  return (
    <div
      className={`flex items-center justify-between border-b border-[#e8e0c0] bg-[#fdf6e3] px-2 py-1 gap-2 min-h-[28px] ${gras ? "font-semibold" : ""}`}
      style={{ paddingLeft }}
    >
      <span className={`text-[12px] text-slate-700 flex-1 ${gras ? "font-semibold" : ""}`}>
        {label}
        {sous && <span className="text-slate-400 italic text-[11px] ml-1">{sous}</span>}
      </span>
      <div className="w-36 border border-[#aaa] bg-white text-right text-[12px] px-2 py-0.5 text-slate-800 tabular-nums">
        {valeur !== undefined && valeur !== "" ? valeur : ""}
      </div>
    </div>
  );
}

/** Ligne de total (fond légèrement plus sombre, lecture seule) */
function LigneTotal({ label, valeur }: { label: string; valeur?: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-[#c8b87a] bg-[#f5edc8] px-4 py-1 gap-2 min-h-[28px]">
      <span className="text-[12px] font-semibold text-slate-700 flex-1 text-right pr-4">{label}</span>
      <div className="w-36 border border-[#aaa] bg-[#e8e0c0] text-right text-[12px] px-2 py-0.5 text-slate-800 font-semibold tabular-nums">
        {valeur !== undefined && valeur !== "" ? valeur : ""}
      </div>
    </div>
  );
}

// ─── Form 2033-B : Compte de résultat ────────────────────────────────────────
function Form2033B({ loyers, depenses, anneeFiscale, lignes, chargesFinCalc, onResultatChange }: {
  loyers: LoyerPercu[];
  depenses: Depense[];
  anneeFiscale: number;
  lignes: LigneAmortissement[];
  chargesFinCalc: number;
  onResultatChange: (v: number) => void;
}) {
  const [d, setD] = useState({
    // Produits d'exploitation
    ventes_export: '', ventes_total: '',
    biens_export: '', biens_total: '',
    services_export: '', services_total: '',
    prod_stockee: '', prod_immob: '', subventions_expl: '', autres_produits: '',
    // Charges d'exploitation
    achats_march: '', var_stock_march: '',
    achats_matieres: '', var_stock_mat: '',
    autres_ext: '', credit_bail_mob: '', credit_bail_immo: '',
    impots: '', tpcfe: '',
    remunerations: '',
    cotisations: '', cotisations_perso: '',
    dot_amort: '', amort_fonds: '',
    dot_dep: '',
    autres_charges: '', prov_fiscales: '', cot_syndicales: '',
    // Produits et charges divers
    prod_fin: '', prod_excep: '',
    charges_fin: '',
    charges_excep: '', amort_pme: '', amort_constructions: '',
    impots_benef: '',
  });

  type DKey = keyof typeof d;
  const upd = (k: DKey, v: string) => setD(p => ({ ...p, [k]: v }));
  const nv = (k: DKey) => parseFloat(d[k]) || 0;
  const fmt = (v: number) => v === 0 ? '' : v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Valeurs calculées automatiquement
  const servicesCalc = loyers
    .filter(l => parseInt(l.exercice) === anneeFiscale)
    .reduce((s, l) => s + parseFloat(l.loyerMensuel) * parseInt(l.nombreMois), 0);
  const impotsCalc = depenses
    .filter(dep => parseInt(dep.annee) === anneeFiscale && dep.type === 'Impôts')
    .reduce((s, dep) => s + (parseFloat(dep.montant) || 0), 0);
  const ligneAnnee   = lignes.find(l => l.annee === anneeFiscale);
  const dotAmortCalc = ligneAnnee ? ligneAnnee.amortissementPeriode : 0;

  const totalI  = nv('ventes_total') + nv('biens_total') + servicesCalc + nv('prod_stockee') + nv('prod_immob') + nv('subventions_expl') + nv('autres_produits');
  const totalII = nv('achats_march') + nv('var_stock_march') + nv('achats_matieres') + nv('var_stock_mat') + nv('autres_ext') + impotsCalc + nv('remunerations') + nv('cotisations') + dotAmortCalc + nv('dot_dep') + nv('autres_charges');
  const resultat = totalI - totalII;
  const benefice = (totalI + nv('prod_fin') + nv('prod_excep')) - (totalII + chargesFinCalc + nv('charges_excep') + nv('impots_benef'));
  useEffect(() => { onResultatChange(benefice); }, [benefice]); // eslint-disable-line react-hooks/exhaustive-deps

  const inp     = "border border-[#999] bg-white text-right text-[12px] px-1 py-0.5 text-slate-800 tabular-nums focus:outline-none focus:border-indigo-400 w-full";
  const totCell = "border border-[#bbb] bg-[#e0ddc8] text-right text-[12px] px-1 py-0.5 text-slate-800 font-semibold tabular-nums w-full";
  const W = 'w-28';
  const rowCls    = "border-b border-[#e0d8c0] bg-[#fdf6e3]";
  const totRowCls = "border-b border-[#c8b87a] bg-[#f5edc8]";

  function inpCell(k: DKey) {
    return (
      <td className={`px-1 py-0.5 ${W}`}>
        <input type="number" value={d[k]} onChange={e => upd(k, e.target.value)} className={inp} placeholder="0" />
      </td>
    );
  }
  function emptyCell() { return <td className={`px-1 py-0.5 ${W}`} />; }
  function cmpdCell(v: number) {
    return (
      <td className={`px-1 py-0.5 ${W}`}>
        <div className="border border-[#bbb] bg-[#e8e8e8] text-right text-[12px] px-1 py-0.5 text-slate-700 tabular-nums w-full">{fmt(v)}</div>
      </td>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BanniereNeant />
      <TitreSection label="A – Résultat comptable" />

      {/* ── Produits d'exploitation ── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#1a4f72] text-white text-[11px] font-bold uppercase tracking-wide">
              <th className="px-3 py-2 text-left" colSpan={3}>Produits d'exploitation</th>
              <th className={`px-2 py-2 text-right ${W}`}>Exercice N</th>
            </tr>
          </thead>
          <tbody>
            {/* Ventes de marchandises */}
            <tr className={rowCls}>
              <td className="px-3 py-1 text-[12px] text-slate-700">Ventes de marchandises</td>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont export et livraisons intracommunautaires</td>
              {inpCell('ventes_export')}
              {inpCell('ventes_total')}
            </tr>
            {/* Production vendue */}
            <tr className={rowCls}>
              <td rowSpan={2} className="px-3 py-1 text-[12px] text-slate-700 align-middle border-r border-[#e0d8c0]">Production vendue</td>
              <td className="px-3 py-1 text-[12px] text-slate-700">Biens <span className="text-[11px] text-slate-500 italic ml-1">– dont export et livraisons intracommunautaires</span></td>
              {inpCell('biens_export')}
              {inpCell('biens_total')}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-1 text-[12px] text-slate-700">Services <span className="text-[11px] text-slate-500 italic ml-1">– dont export et livraisons intracommunautaires</span></td>
              {inpCell('services_export')}
              {cmpdCell(servicesCalc)}
            </tr>
            {/* Simples */}
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Production stockée <i className="text-[11px] text-slate-500">(variation du stock en produits intermédiaires, produits finis et en cours de production)</i></td>{inpCell('prod_stockee')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Production immobilisée</td>{inpCell('prod_immob')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Subventions d'exploitation reçues</td>{inpCell('subventions_expl')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Autres produits</td>{inpCell('autres_produits')}</tr>
            {/* Total I */}
            <tr className={totRowCls}>
              <td colSpan={3} className="px-3 py-1 text-[12px] font-semibold text-slate-700 text-right pr-4">Total des produits d'exploitation hors T.V.A. (I)</td>
              <td className={`px-1 py-0.5 ${W}`}><div className={totCell}>{fmt(totalI)}</div></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Charges d'exploitation ── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#1a4f72] text-white text-[11px] font-bold uppercase tracking-wide">
              <th className="px-3 py-2 text-left" colSpan={3}>Charges d'exploitation</th>
              <th className={`px-2 py-2 ${W}`} />
            </tr>
          </thead>
          <tbody>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Achats de marchandises <i className="text-[11px] text-slate-500">(y compris droits de douane)</i></td>{inpCell('achats_march')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Variation de stock <i className="text-[11px] text-slate-500">(marchandises)</i></td>{inpCell('var_stock_march')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Achats de matières premières et autres approvisionnements <i className="text-[11px] text-slate-500">(y compris droits de douane)</i></td>{inpCell('achats_matieres')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Variation de stock <i className="text-[11px] text-slate-500">(matières premières et approvisionnements)</i></td>{inpCell('var_stock_mat')}</tr>
            {/* Autres charges externes */}
            <tr className={rowCls}>
              <td rowSpan={3} className="px-3 py-1 text-[12px] text-slate-700 align-middle border-r border-[#e0d8c0]">Autres charges externes</td>
              <td colSpan={2} className="px-1 py-0.5" />
              {inpCell('autres_ext')}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont crédit-bail mobilier</td>
              {inpCell('credit_bail_mob')}{emptyCell()}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont crédit-bail immobilier</td>
              {inpCell('credit_bail_immo')}{emptyCell()}
            </tr>
            {/* Impôts */}
            <tr className={rowCls}>
              <td rowSpan={2} className="px-3 py-1 text-[12px] text-slate-700 align-middle border-r border-[#e0d8c0]">Impôts, taxes et versements assimilés</td>
              <td colSpan={2} className="px-1 py-0.5" />
              {cmpdCell(impotsCalc)}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont TP/CFE, CVAE</td>
              {inpCell('tpcfe')}{emptyCell()}
            </tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Rémunérations du personnel</td>{inpCell('remunerations')}</tr>
            {/* Cotisations */}
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Cotisations sociales</td>{inpCell('cotisations')}</tr>
            <tr className={rowCls}>
              <td className="px-1 py-0.5" />
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont cotisations personnelles de l'exploitant</td>
              {inpCell('cotisations_perso')}{emptyCell()}
            </tr>
            {/* Dotations amort */}
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Dotations aux amortissements</td>{cmpdCell(dotAmortCalc)}</tr>
            <tr className={rowCls}>
              <td className="px-1 py-0.5" />
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont amortissement du fonds de commerce</td>
              {inpCell('amort_fonds')}{emptyCell()}
            </tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Dotations aux dépréciations</td>{inpCell('dot_dep')}</tr>
            {/* Autres charges */}
            <tr className={rowCls}>
              <td rowSpan={3} className="px-3 py-1 text-[12px] text-slate-700 align-middle border-r border-[#e0d8c0]">Autres charges</td>
              <td colSpan={2} className="px-1 py-0.5" />
              {inpCell('autres_charges')}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont provisions fiscales pour implantations commerciales à l'étranger</td>
              {inpCell('prov_fiscales')}{emptyCell()}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont cotisations versées aux organisations syndicales et professionnelles</td>
              {inpCell('cot_syndicales')}{emptyCell()}
            </tr>
            {/* Total II */}
            <tr className={totRowCls}>
              <td colSpan={3} className="px-3 py-1 text-[12px] font-semibold text-slate-700 text-right pr-4">Total des charges d'exploitation (II)</td>
              <td className={`px-1 py-0.5 ${W}`}><div className={totCell}>{fmt(totalII)}</div></td>
            </tr>
            {/* 1 – Résultat d'exploitation */}
            <tr className="border-b border-[#c8b87a] bg-[#f5edc8]">
              <td colSpan={3} className="px-3 py-1 text-[12px] font-bold text-slate-700 text-right pr-4">1 – RÉSULTAT D'EXPLOITATION (I – II)</td>
              <td className={`px-1 py-0.5 ${W}`}><div className={totCell}>{resultat === 0 ? '0' : fmt(resultat)}</div></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Produits et charges divers ── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#1a4f72] text-white text-[11px] font-bold uppercase tracking-wide">
              <th className="px-3 py-2 text-left" colSpan={3}>Produits et charges divers</th>
              <th className={`px-2 py-2 ${W}`} />
            </tr>
          </thead>
          <tbody>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Produits financiers (III)</td>{inpCell('prod_fin')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Produits exceptionnels (IV)</td>{inpCell('prod_excep')}</tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Charges financières (V)</td>{cmpdCell(chargesFinCalc)}</tr>
            {/* Charges exceptionnelles */}
            <tr className={rowCls}>
              <td rowSpan={3} className="px-3 py-1 text-[12px] text-slate-700 align-middle border-r border-[#e0d8c0]">Charges exceptionnelles (VI)</td>
              <td colSpan={2} className="px-1 py-0.5" />
              {inpCell('charges_excep')}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont amortissement des souscriptions dans des PME innovantes <i>(art. 217 octies)</i></td>
              {inpCell('amort_pme')}{emptyCell()}
            </tr>
            <tr className={rowCls}>
              <td className="px-3 py-0.5 text-[11px] text-slate-500 italic text-right">dont amortissement exceptionnel de 25% des constructions nouvelles <i>(art. 39 quinquies D)</i></td>
              {inpCell('amort_constructions')}{emptyCell()}
            </tr>
            <tr className={rowCls}><td colSpan={3} className="px-3 py-1 text-[12px] text-slate-700">Impôts sur les bénéfices (VII)</td>{inpCell('impots_benef')}</tr>
            {/* 2 – Bénéfice ou perte */}
            <tr className="border-b border-[#c8b87a] bg-[#f5edc8]">
              <td colSpan={3} className="px-3 py-1 text-[12px] font-bold text-slate-700 text-right pr-4">2 – BÉNÉFICE OU PERTE : Produits (I + III + IV) – Charges (II + V + VI + VII)</td>
              <td className={`px-1 py-0.5 ${W}`}><div className={totCell}>{benefice === 0 ? '0' : fmt(benefice)}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Form 2033-C : Immobilisations ────────────────────────────────────────────
function Form2033C({ montantAchat, premiereAnnee, anneeFiscale, lignes }: {
  montantAchat: string;
  premiereAnnee: string;
  anneeFiscale: number;
  lignes: LigneAmortissement[];
}) {
  const v0: ImmoLigne = { debut: '', aug: '', dim: '', reeval: '' };
  const [immo, setImmo] = useState({
    incorp_fonds: { ...v0 },
    incorp_autres: { ...v0 },
    corp_terrains: { ...v0 },
    corp_constructions: { ...v0 },
    corp_install_tech: { ...v0 },
    corp_install_gen: { ...v0 },
    corp_transport: { ...v0 },
    corp_autres: { ...v0 },
    financieres: { ...v0 },
  });

  type ImmoKey = keyof typeof immo;

  const a0 = { debut: '', aug: '', dim: '' };
  const [amort, setAmort] = useState({
    incorp_fonds:       { ...a0 }, incorp_autres:      { ...a0 },
    corp_terrains:      { ...a0 }, corp_constructions: { ...a0 },
    corp_install_tech:  { ...a0 }, corp_install_gen:   { ...a0 },
    corp_transport:     { ...a0 }, corp_autres:        { ...a0 },
  });
  type AmortKey = keyof typeof amort;
  function updA(k: AmortKey, f: 'debut' | 'aug' | 'dim', v: string) {
    setAmort(prev => ({ ...prev, [k]: { ...prev[k], [f]: v } }));
  }
  // Valeurs calculées pour la ligne Constructions (Section I)
  const montant      = parseFloat(montantAchat) || 0;
  const isPremiere   = anneeFiscale === (parseInt(premiereAnnee) || anneeFiscale);
  const debutConstr  = isPremiere ? 0 : montant;
  const augConstr    = isPremiere ? montant : 0;

  // Valeurs calculées pour la ligne Constructions (Section II – Amortissements)
  const ligneAnnee       = lignes.find(l => l.annee === anneeFiscale);
  const amortDebutConstr = ligneAnnee ? ligneAnnee.debutPeriode : 0;
  const amortAugConstr   = ligneAnnee ? ligneAnnee.amortissementPeriode : 0;

  const amortKeys = Object.keys(amort) as AmortKey[];
  const totAD  = amortKeys.reduce((s, k) => s + (k === 'corp_constructions' ? amortDebutConstr : (parseFloat(amort[k].debut) || 0)), 0);
  const totAA  = amortKeys.reduce((s, k) => s + (k === 'corp_constructions' ? amortAugConstr   : (parseFloat(amort[k].aug)   || 0)), 0);
  const totADm = amortKeys.reduce((s, k) => s + (parseFloat(amort[k].dim)   || 0), 0);
  const totAF  = totAD + totAA - totADm;

  function upd(k: ImmoKey, f: keyof ImmoLigne, v: string) {
    setImmo(prev => ({ ...prev, [k]: { ...prev[k], [f]: v } }));
  }

  function calcFin(l: ImmoLigne) {
    return (parseFloat(l.debut) || 0) + (parseFloat(l.aug) || 0) - (parseFloat(l.dim) || 0);
  }

  function fmtC(n: number) {
    return n === 0 ? '' : n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  const allKeys = Object.keys(immo) as ImmoKey[];
  const totDebut  = allKeys.reduce((s, k) => s + (k === 'corp_constructions' ? debutConstr : (parseFloat(immo[k].debut)  || 0)), 0);
  const totAug    = allKeys.reduce((s, k) => s + (k === 'corp_constructions' ? augConstr   : (parseFloat(immo[k].aug)    || 0)), 0);
  const totDim    = allKeys.reduce((s, k) => s + (parseFloat(immo[k].dim)    || 0), 0);
  const totReeval = allKeys.reduce((s, k) => s + (parseFloat(immo[k].reeval) || 0), 0);
  const totFin    = allKeys.reduce((s, k) => {
    if (k === 'corp_constructions') return s + debutConstr + augConstr - (parseFloat(immo[k].dim) || 0);
    return s + calcFin(immo[k]);
  }, 0);

  const inp     = "border border-[#999] bg-white text-right text-[12px] px-1 py-0.5 text-slate-800 tabular-nums focus:outline-none focus:border-indigo-400 w-full";
  const cmpd    = "border border-[#bbb] bg-[#e8e8e8] text-right text-[12px] px-1 py-0.5 text-slate-700 tabular-nums w-full";
  const totCell = "border border-[#bbb] bg-[#e0ddc8] text-right text-[12px] px-1 py-0.5 text-slate-800 font-semibold tabular-nums w-full";

  type RowConf = { key: ImmoKey; label: string; cDebut?: number; cAug?: number };

  function renderRow({ key: k, label, cDebut, cAug }: RowConf) {
    const l = immo[k];
    const dv = cDebut !== undefined ? cDebut : (parseFloat(l.debut) || 0);
    const av = cAug   !== undefined ? cAug   : (parseFloat(l.aug)   || 0);
    return (
      <tr key={k} className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
        <td className="px-3 py-1 text-[12px] text-slate-700 min-w-[200px]">{label}</td>
        <td className="px-1 py-0.5 w-32">
          {cDebut !== undefined
            ? <div className={cmpd}>{fmtC(cDebut)}</div>
            : <input type="number" value={l.debut} onChange={e => upd(k, 'debut', e.target.value)} className={inp} placeholder="0" />}
        </td>
        <td className="px-1 py-0.5 w-32">
          {cAug !== undefined
            ? <div className={cmpd}>{fmtC(cAug)}</div>
            : <input type="number" value={l.aug} onChange={e => upd(k, 'aug', e.target.value)} className={inp} placeholder="0" />}
        </td>
        <td className="px-1 py-0.5 w-32"><input type="number" value={l.dim}    onChange={e => upd(k, 'dim',    e.target.value)} className={inp} placeholder="0" /></td>
        <td className="px-1 py-0.5 w-32"><div className={cmpd}>{fmtC(dv + av - (parseFloat(l.dim) || 0))}</div></td>
        <td className="px-1 py-0.5 w-32"><input type="number" value={l.reeval} onChange={e => upd(k, 'reeval', e.target.value)} className={inp} placeholder="0" /></td>
      </tr>
    );
  }

  function grpHdr(label: string) {
    return (
      <tr key={label} className="bg-[#c8d8e8]">
        <td colSpan={6} className="px-3 py-1 text-[11px] font-bold text-[#1a4f72] uppercase tracking-wide">{label}</td>
      </tr>
    );
  }

  const incorpRows: RowConf[] = [
    { key: 'incorp_fonds',  label: 'Fonds commercial' },
    { key: 'incorp_autres', label: 'Autres immobilisations incorporelles' },
  ];
  const corpRows: RowConf[] = [
    { key: 'corp_terrains',      label: 'Terrains' },
    { key: 'corp_constructions', label: 'Constructions', cDebut: debutConstr, cAug: augConstr },
    { key: 'corp_install_tech',  label: 'Installations techniques, matériel et outillage' },
    { key: 'corp_install_gen',   label: 'Installations générales, agencements et aménagements' },
    { key: 'corp_transport',     label: 'Matériel de transport' },
    { key: 'corp_autres',        label: 'Autres immobilisations corporelles' },
  ];

  return (
    <div className="p-4">
      <BanniereNeant />
      <div className="mt-4">
        <TitreSection label="I — Immobilisations" />
        <div className="overflow-x-auto mt-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#1a4f72] text-white text-[11px] font-bold uppercase tracking-wide">
                <th className="px-3 py-2 text-left min-w-[200px]">Actif immobilisé</th>
                <th className="px-2 py-2 text-right w-32">Valeur brute début</th>
                <th className="px-2 py-2 text-right w-32">Augmentations</th>
                <th className="px-2 py-2 text-right w-32">Diminutions</th>
                <th className="px-2 py-2 text-right w-32">Valeur brute fin</th>
                <th className="px-2 py-2 text-right w-32">Réévaluation légale</th>
              </tr>
            </thead>
            <tbody>
              {grpHdr('Immobilisations incorporelles')}
              {incorpRows.map(renderRow)}
              {grpHdr('Immobilisations corporelles')}
              {corpRows.map(renderRow)}
              {grpHdr('Immobilisations financières')}
              {renderRow({ key: 'financieres', label: 'Immobilisations financières' })}
              <tr className="border-b border-[#c8b87a] bg-[#f5edc8]">
                <td className="px-3 py-1 text-[12px] font-semibold text-slate-700">TOTAL RUBRIQUE I</td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totDebut)}</div></td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totAug)}</div></td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totDim)}</div></td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totFin)}</div></td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totReeval)}</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section II – Amortissements ── */}
      <div className="mt-6">
        <TitreSection label="II — Amortissements" />
        <div className="overflow-x-auto mt-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#1a4f72] text-white text-[11px] font-bold uppercase tracking-wide">
                <th className="px-3 py-2 text-left min-w-[200px]">Immobilisations amortissables</th>
                <th className="px-2 py-2 text-right w-32">Amortissements au début de l'exercice</th>
                <th className="px-2 py-2 text-right w-32">Augmentations (dotations de l'exercice)</th>
                <th className="px-2 py-2 text-right w-32">Diminutions</th>
                <th className="px-2 py-2 text-right w-32">Amortissements à la fin de l'exercice</th>
              </tr>
            </thead>
            <tbody>
              {/* Helper inline : évite les re-mounts */}
              {([
                { group: 'Fonds commercial',                    key: 'incorp_fonds' as AmortKey,      label: '' },
                { group: 'Autres immobilisations incorporelles', key: 'incorp_autres' as AmortKey,     label: '' },
              ] as { group: string; key: AmortKey; label: string }[]).map(({ group, key: k, label }) => {
                const l = amort[k];
                const finV = (parseFloat(l.debut)||0) + (parseFloat(l.aug)||0) - (parseFloat(l.dim)||0);
                return (
                  <Fragment key={k}>
                    <tr className="bg-[#c8d8e8]">
                      <td colSpan={5} className="px-3 py-1 text-[11px] font-bold text-[#1a4f72] uppercase tracking-wide">{group}</td>
                    </tr>
                    <tr className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
                      <td className="px-3 py-1 text-[12px] text-slate-700">{label}</td>
                      <td className="px-1 py-0.5 w-32"><input type="number" value={l.debut} onChange={e => updA(k,'debut',e.target.value)} className={inp} placeholder="0" /></td>
                      <td className="px-1 py-0.5 w-32"><input type="number" value={l.aug}   onChange={e => updA(k,'aug',  e.target.value)} className={inp} placeholder="0" /></td>
                      <td className="px-1 py-0.5 w-32"><input type="number" value={l.dim}   onChange={e => updA(k,'dim',  e.target.value)} className={inp} placeholder="0" /></td>
                      <td className="px-1 py-0.5 w-32"><div className={cmpd}>{fmtC(finV)}</div></td>
                    </tr>
                  </Fragment>
                );
              })}
              <tr className="bg-[#c8d8e8]">
                <td colSpan={5} className="px-3 py-1 text-[11px] font-bold text-[#1a4f72] uppercase tracking-wide">Immobilisations corporelles</td>
              </tr>
              {([
                { key: 'corp_terrains'      as AmortKey, label: 'Terrains' },
                { key: 'corp_constructions' as AmortKey, label: 'Constructions' },
                { key: 'corp_install_tech'  as AmortKey, label: 'Installations techniques, matériel et outillage industriels' },
                { key: 'corp_install_gen'   as AmortKey, label: 'Installations générales, agencements, aménagements divers' },
                { key: 'corp_transport'     as AmortKey, label: 'Matériel de transport' },
                { key: 'corp_autres'        as AmortKey, label: 'Autres immobilisations corporelles' },
              ] as { key: AmortKey; label: string }[]).map(({ key: k, label }) => {
                const l = amort[k];
                const isConstr = k === 'corp_constructions';
                const dv = isConstr ? amortDebutConstr : (parseFloat(l.debut) || 0);
                const av = isConstr ? amortAugConstr   : (parseFloat(l.aug)   || 0);
                const finV = dv + av - (parseFloat(l.dim) || 0);
                return (
                  <tr key={k} className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
                    <td className="px-3 py-1 text-[12px] text-slate-700 min-w-[200px]">{label}</td>
                    <td className="px-1 py-0.5 w-32">
                      {isConstr
                        ? <div className={cmpd}>{fmtC(amortDebutConstr)}</div>
                        : <input type="number" value={l.debut} onChange={e => updA(k,'debut',e.target.value)} className={inp} placeholder="0" />}
                    </td>
                    <td className="px-1 py-0.5 w-32">
                      {isConstr
                        ? <div className={cmpd}>{fmtC(amortAugConstr)}</div>
                        : <input type="number" value={l.aug} onChange={e => updA(k,'aug',e.target.value)} className={inp} placeholder="0" />}
                    </td>
                    <td className="px-1 py-0.5 w-32"><input type="number" value={l.dim} onChange={e => updA(k,'dim',e.target.value)} className={inp} placeholder="0" /></td>
                    <td className="px-1 py-0.5 w-32"><div className={cmpd}>{fmtC(finV)}</div></td>
                  </tr>
                );
              })}
              <tr className="border-b border-[#c8b87a] bg-[#f5edc8]">
                <td className="px-3 py-1 text-[12px] font-semibold text-slate-700">TOTAL RUBRIQUE II</td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totAD)}</div></td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totAA)}</div></td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totADm)}</div></td>
                <td className="px-1 py-0.5"><div className={totCell}>{fmtC(totAF)}</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Form 2033-A : Bilan simplifié ───────────────────────────────────────────
function Form2033A({ montantAchat, lignes, anneeFiscale, capitalRestantFinN, capitalRestantFinNplus1, resultatExploitation }: {
  montantAchat: string;
  lignes: LigneAmortissement[];
  anneeFiscale: number;
  capitalRestantFinN: number;
  capitalRestantFinNplus1: number;
  resultatExploitation: number;
}) {
  const vA: ActifLigne = { brut: '', amort: '' };
  const [actif, setActif] = useState({
    incorp:        { ...vA }, corp:          { ...vA },
    fin:           { ...vA }, charges:       { ...vA },
    stocks:        { ...vA }, avancesV:      { ...vA },
    creances:      { ...vA }, autresCreances:{ ...vA },
    vmp:           { ...vA }, dispos:        { ...vA },
    chargesAv:     { ...vA }, ecartsConvA:   { ...vA },
  });
  const [passif, setPassif] = useState({
    capital: '', primes: '', ecartsReeval: '', reserves: '',
    reportANouveau: '', resultat: '', subventions: '', provsRegl: '',
    totalII: '',
    avancesRecues: '', fournisseurs: '', fiscSoc: '',
    dettesImmo: '', autresDettes: '', prodsConst: '',
  });
  const [renvois, setRenvois] = useState({
    amorts: '', provisions: '', pvCourt: '', pvLong: '', mvCourt: '', mvLong: '',
  });

  type AKey = keyof typeof actif;
  type PKey = keyof typeof passif;
  type RKey = keyof typeof renvois;

  function setA(k: AKey, f: keyof ActifLigne, v: string) {
    setActif(a => ({ ...a, [k]: { ...a[k], [f]: v } }));
  }
  function setP(k: PKey, v: string) { setPassif(p => ({ ...p, [k]: v })); }
  function setR(k: RKey, v: string) { setRenvois(r => ({ ...r, [k]: v })); }

  function netA(l: ActifLigne) { return (parseFloat(l.brut) || 0) - (parseFloat(l.amort) || 0); }
  function fmtA(n: number) { return n === 0 ? '' : n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

  // Valeurs calculées pour Immobilisations corporelles
  const corpBrut  = parseFloat(montantAchat) || 0;
  const ligneN    = lignes.find(l => l.annee === anneeFiscale);
  const corpAmort = ligneN ? ligneN.finPeriode : 0;

  const immoKeys: AKey[] = ['incorp', 'corp', 'fin', 'charges'];
  const circKeys: AKey[] = ['stocks', 'avancesV', 'creances', 'autresCreances', 'vmp', 'dispos', 'chargesAv', 'ecartsConvA'];

  function sumBrut(keys: AKey[])  { return keys.reduce((s, k) => s + (k === 'corp' ? corpBrut  : (parseFloat(actif[k].brut)  || 0)), 0); }
  function sumAmort(keys: AKey[]) { return keys.reduce((s, k) => s + (k === 'corp' ? corpAmort : (parseFloat(actif[k].amort) || 0)), 0); }
  function sumNet(keys: AKey[])   { return keys.reduce((s, k) => s + (k === 'corp' ? corpBrut - corpAmort : netA(actif[k])), 0); }

  const brutI  = sumBrut(immoKeys),  amortI  = sumAmort(immoKeys),  netI  = sumNet(immoKeys);
  const brutII = sumBrut(circKeys),  amortII = sumAmort(circKeys),  netII = sumNet(circKeys);

  const passifIKeys:   PKey[] = ['capital','primes','ecartsReeval','reserves','reportANouveau','resultat','subventions','provsRegl'];
  const passifIIIKeys: PKey[] = ['avancesRecues','fournisseurs','fiscSoc','dettesImmo','autresDettes','prodsConst'];
  function sumP(keys: PKey[]) { return keys.reduce((s, k) => s + (parseFloat(passif[k]) || 0), 0); }
  const totalI_p   = (netI + netII) - capitalRestantFinN;
  const totalII_p  = parseFloat(passif.totalII) || 0;
  const totalIII_p = capitalRestantFinN + sumP(passifIIIKeys);

  const inp     = "border border-[#999] bg-white text-right text-[12px] px-1 py-0.5 text-slate-800 tabular-nums focus:outline-none focus:border-indigo-400 w-full";
  const cmpd    = "border border-[#bbb] bg-[#e8e8e8] text-right text-[12px] px-1 py-0.5 text-slate-700 tabular-nums w-full";
  const totCell = "border border-[#bbb] bg-[#e0ddc8] text-right text-[12px] px-1 py-0.5 text-slate-800 font-semibold tabular-nums w-full";

  type ActifRowConf = { key: AKey; label: string; noAmort?: boolean; cBrut?: number; cAmort?: number };

  function renderActifRow({ key: k, label, noAmort, cBrut, cAmort }: ActifRowConf) {
    const l = actif[k];
    const brutVal  = cBrut  !== undefined ? cBrut  : (parseFloat(l.brut)  || 0);
    const amortVal = cAmort !== undefined ? cAmort : (parseFloat(l.amort) || 0);
    return (
      <tr key={k} className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
        <td className="px-3 py-1 text-[12px] text-slate-700">{label}</td>
        <td className="px-1 py-0.5 w-32">
          {cBrut !== undefined
            ? <div className={cmpd}>{fmtA(cBrut)}</div>
            : <input type="number" value={l.brut} onChange={e => setA(k, 'brut', e.target.value)} className={inp} placeholder="0" />}
        </td>
        <td className="px-1 py-0.5 w-32">
          {cAmort !== undefined
            ? <div className={cmpd}>{fmtA(cAmort)}</div>
            : noAmort
              ? <div className={cmpd} />
              : <input type="number" value={l.amort} onChange={e => setA(k, 'amort', e.target.value)} className={inp} placeholder="0" />}
        </td>
        <td className="px-1 py-0.5 w-32"><div className={cmpd}>{fmtA(brutVal - amortVal)}</div></td>
      </tr>
    );
  }

  function renderActifTotal(label: string, b: number, a: number, n: number) {
    return (
      <tr className="border-b border-[#c8b87a] bg-[#f5edc8]">
        <td className="px-3 py-1 text-[12px] font-semibold text-slate-700">{label}</td>
        <td className="px-1 py-0.5"><div className={totCell}>{fmtA(b)}</div></td>
        <td className="px-1 py-0.5"><div className={totCell}>{fmtA(a)}</div></td>
        <td className="px-1 py-0.5"><div className={totCell}>{fmtA(n)}</div></td>
      </tr>
    );
  }

  function grpHdr(label: string, cols: number) {
    return (
      <tr key={label} className="bg-[#c8d8e8]">
        <td colSpan={cols} className="px-3 py-1 text-[11px] font-bold text-[#1a4f72] uppercase tracking-wide">{label}</td>
      </tr>
    );
  }

  const immoRows: ActifRowConf[] = [
    { key: 'incorp',   label: 'Immobilisations incorporelles' },
    { key: 'corp',     label: 'Immobilisations corporelles', cBrut: corpBrut, cAmort: corpAmort },
    { key: 'fin',      label: 'Immobilisations financières' },
    { key: 'charges',  label: 'Charges à répartir sur plusieurs exercices' },
  ];
  const circRows: ActifRowConf[] = [
    { key: 'stocks',         label: 'Stocks et en-cours',                              noAmort: true },
    { key: 'avancesV',       label: 'Avances et acomptes versés sur commandes',        noAmort: true },
    { key: 'creances',       label: 'Créances clients et comptes rattachés' },
    { key: 'autresCreances', label: 'Autres créances',                                 noAmort: true },
    { key: 'vmp',            label: 'Valeurs mobilières de placement',                 noAmort: true },
    { key: 'dispos',         label: 'Disponibilités',                                  noAmort: true },
    { key: 'chargesAv',      label: "Charges constatées d'avance",                     noAmort: true },
    { key: 'ecartsConvA',    label: 'Écarts de conversion actif',                      noAmort: true },
  ];

  function renderPassifRow(k: PKey, label: string) {
    return (
      <tr key={k} className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
        <td className="px-3 py-1 text-[12px] text-slate-700">{label}</td>
        <td className="px-1 py-0.5 w-40">
          <input type="number" value={passif[k]} onChange={e => setP(k, e.target.value)} className={inp} placeholder="0" />
        </td>
      </tr>
    );
  }

  function renderPassifTotal(label: string, value: number) {
    return (
      <tr className="border-b border-[#c8b87a] bg-[#f5edc8]">
        <td className="px-3 py-1 text-[12px] font-semibold text-right pr-4 text-slate-700">{label}</td>
        <td className="px-1 py-0.5 w-40"><div className={totCell}>{fmtA(value)}</div></td>
      </tr>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <BanniereNeant />

      {/* ── ACTIF ── */}
      <div>
        <TitreSection label="ACTIF" />
        <div className="overflow-x-auto mt-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#1a4f72] text-white text-[11px] font-bold uppercase tracking-wide">
                <th className="px-3 py-2 text-left">Poste du bilan</th>
                <th className="px-2 py-2 text-right w-32">Brut</th>
                <th className="px-2 py-2 text-right w-32">Amortissements et provisions</th>
                <th className="px-2 py-2 text-right w-32">Net</th>
              </tr>
            </thead>
            <tbody>
              {grpHdr('Actif immobilisé', 4)}
              {immoRows.map(renderActifRow)}
              {renderActifTotal('TOTAL I', brutI, amortI, netI)}
              {grpHdr('Actif circulant', 4)}
              {circRows.map(renderActifRow)}
              {renderActifTotal('TOTAL II', brutII, amortII, netII)}
              {renderActifTotal('TOTAL GÉNÉRAL ACTIF', brutI + brutII, amortI + amortII, netI + netII)}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PASSIF ── */}
      <div>
        <TitreSection label="PASSIF" />
        <div className="overflow-x-auto mt-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#1a4f72] text-white text-[11px] font-bold uppercase tracking-wide">
                <th className="px-3 py-2 text-left">Poste du bilan</th>
                <th className="px-2 py-2 text-right w-40">Montant</th>
              </tr>
            </thead>
            <tbody>
              {grpHdr('Capitaux propres', 2)}
              <tr className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
                <td className="px-3 py-1 text-[12px] text-slate-700">Capital social ou individuel</td>
                <td className="px-1 py-0.5 w-40"><div className={cmpd}>{fmtA(totalI_p - resultatExploitation)}</div></td>
              </tr>
              {renderPassifRow('primes',          "Primes d'émission, de fusion, d'apport")}
              {renderPassifRow('ecartsReeval',    'Écarts de réévaluation')}
              {renderPassifRow('reserves',        'Réserves')}
              {renderPassifRow('reportANouveau',  'Report à nouveau')}
              <tr className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
                <td className="px-3 py-1 text-[12px] text-slate-700">{"Résultat de l'exercice (bénéfice ou perte)"}</td>
                <td className="px-1 py-0.5 w-40"><div className={cmpd}>{fmtA(resultatExploitation)}</div></td>
              </tr>
              {renderPassifRow('subventions',     "Subventions d'investissement")}
              {renderPassifRow('provsRegl',       'Provisions réglementées')}
              {renderPassifTotal('TOTAL I – Capitaux propres', totalI_p)}
              {grpHdr('Provisions pour risques et charges', 2)}
              {renderPassifRow('totalII',         'Provisions pour risques et charges')}
              {renderPassifTotal('TOTAL II', totalII_p)}
              {grpHdr('Dettes', 2)}
              <tr className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
                <td className="px-3 py-1 text-[12px] text-slate-700">Emprunts et dettes assimilées</td>
                <td className="px-1 py-0.5 w-40"><div className={cmpd}>{fmtA(capitalRestantFinN)}</div></td>
              </tr>
              {renderPassifRow('avancesRecues',   'Avances et acomptes reçus sur commandes en cours')}
              {renderPassifRow('fournisseurs',    'Dettes fournisseurs et comptes rattachés')}
              {renderPassifRow('fiscSoc',         'Dettes fiscales et sociales')}
              {renderPassifRow('dettesImmo',      'Dettes sur immobilisations et comptes rattachés')}
              {renderPassifRow('autresDettes',    'Autres dettes')}
              {renderPassifRow('prodsConst',      "Produits constatés d'avance et écarts de conversion passif")}
              {renderPassifTotal('TOTAL III – Dettes', totalIII_p)}
              {renderPassifTotal('TOTAL GÉNÉRAL PASSIF', totalI_p + totalII_p + totalIII_p)}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── RENVOIS ── */}
      <div>
        <TitreSection label="RENVOIS" />
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm border border-[#c8b87a]">
            <tbody>
              {([
                [['amorts',  "Amortissements pratiqués pendant l'exercice"], ['provisions', "(4) Dont dettes à plus d'un an"]],
                [['pvCourt', 'Plus-values à court terme réalisées'],          ['pvLong',     '(5) Coût de revient des immobilisations acquises']],
                [['mvCourt', 'Moins-values à court terme réalisées'],         ['mvLong',     'Moins-values à long terme réalisées']],
              ] as [[RKey, string], [RKey, string]][]).map(([left, right]) => (
                <tr key={left[0]} className="border-b border-[#e0d8c0] bg-[#fdf6e3]">
                  <td className="px-3 py-1 text-[12px] text-slate-700 w-[38%]">{left[1]}</td>
                  <td className="px-1 py-0.5 w-32">
                    <input type="number" value={renvois[left[0]]} onChange={e => setR(left[0], e.target.value)} className={`${inp}`} placeholder="0" />
                  </td>
                  <td className="px-3 py-1 text-[12px] text-slate-700 w-[38%] border-l border-[#e0d8c0]">{right[1]}</td>
                  <td className="px-1 py-0.5 w-32">
                    {right[0] === 'provisions'
                      ? <div className={cmpd}>{fmtA(capitalRestantFinNplus1)}</div>
                      : <input type="number" value={renvois[right[0]]} onChange={e => setR(right[0], e.target.value)} className={`${inp}`} placeholder="0" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function LMNPDeclaration() {
  const [bien, setBien] = useState<BienImmobilier>({
    montantAchat: "",
    dureeAmortissement: "",
    premiereAnneeExercice: "",
    datePremiereMiseEnLocation: "",
  });
  const [tableauOuvert, setTableauOuvert] = useState(true);

  const [loyers, setLoyers] = useState<LoyerPercu[]>([]);
  const [nextId, setNextId] = useState(1);

  const anneeDefaut = String(new Date().getFullYear() - 1);

  function moisRestantsPourAnnee(annee: string, loyersList: LoyerPercu[]): string {
    const total = loyersList
      .filter((l) => l.exercice === annee)
      .reduce((s, l) => s + parseInt(l.nombreMois || "0"), 0);
    const restants = Math.max(0, 12 - total);
    return restants > 0 ? String(restants) : "";
  }

  const [loyerForm, setLoyerForm] = useState({
    exercice: anneeDefaut,
    nombreMois: moisRestantsPourAnnee(anneeDefaut, []),
    loyerMensuel: "",
  });

  const handleLoyerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const updated = { ...loyerForm, [e.target.name]: e.target.value };
    if (e.target.name === "exercice") {
      updated.nombreMois = moisRestantsPourAnnee(e.target.value, loyers);
    }
    setLoyerForm(updated);
  };

  const ajouterLoyer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loyerForm.exercice || !loyerForm.nombreMois || !loyerForm.loyerMensuel) return;
    const newLoyers = [...loyers, { id: nextId, ...loyerForm }];
    setLoyers(newLoyers);
    setNextId((n) => n + 1);
    const nouvelleAnnee = anneeDefaut;
    setLoyerForm({
      exercice: nouvelleAnnee,
      nombreMois: moisRestantsPourAnnee(nouvelleAnnee, newLoyers),
      loyerMensuel: "",
    });
  };

  const supprimerLoyer = (id: number) => {
    setLoyers(loyers.filter((l) => l.id !== id));
  };

  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [depenseForm, setDepenseForm] = useState({
    annee: anneeDefaut,
    type: "",
    montant: "",
    commentaire: "",
  });
  const [nextDepenseId, setNextDepenseId] = useState(1);

  const handleDepenseChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setDepenseForm({ ...depenseForm, [e.target.name]: e.target.value });
  };

  const ajouterDepense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!depenseForm.annee || !depenseForm.type || !depenseForm.montant) return;
    setDepenses([...depenses, { id: nextDepenseId, ...depenseForm }]);
    setNextDepenseId((n) => n + 1);
    setDepenseForm({ annee: anneeDefaut, type: "", montant: "", commentaire: "" });
  };

  const supprimerDepense = (id: number) => {
    setDepenses(depenses.filter((d) => d.id !== id));
  };

  const [prets, setPrets] = useState<Pret[]>([]);
  const [nextPretId, setNextPretId] = useState(1);
  const [pretForm, setPretForm] = useState({
    montant: "",
    dateDebut: "",
    duree: "",
    jourEcheance: "10",
    taux: "",
    fraisDivers: "",
    differeJusquaPretId: "",
  });
  const [modalePretId, setModalePretId] = useState<number | null>(null);
  const [pretEnEditionId, setPretEnEditionId] = useState<number | null>(null);

  const handlePretChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPretForm({ ...pretForm, [e.target.name]: e.target.value });
  };

  // Calcule la date de dernière échéance d'un prêt (sans différé)
  function dateFinPret(p: Pret): Date | null {
    const lignes = calculerAmortissementPret(p);
    const last = lignes.at(-1);
    if (!last) return null;
    const [y, m, d] = last.date.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Retourne les lignes d'un prêt en tenant compte de son éventuel différé
  function lignesPourPret(p: Pret): LigneAmortissementPret[] {
    if (!p.differeJusquaPretId) return calculerAmortissementPret(p);
    const pretRef = prets.find((pr) => pr.id === parseInt(p.differeJusquaPretId));
    if (!pretRef) return calculerAmortissementPret(p);
    const fin = dateFinPret(pretRef);
    return calculerAmortissementPret(p, fin);
  }

  const pretFormVide = { montant: "", dateDebut: "", duree: "", jourEcheance: "10", taux: "", fraisDivers: "", differeJusquaPretId: "" };

  const soumettreFormPret = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pretForm.montant || !pretForm.dateDebut || !pretForm.duree || !pretForm.taux) return;
    if (pretEnEditionId !== null) {
      setPrets(prets.map((p) => p.id === pretEnEditionId ? { id: p.id, ...pretForm } : p));
      setPretEnEditionId(null);
    } else {
      setPrets([...prets, { id: nextPretId, ...pretForm }]);
      setNextPretId((n) => n + 1);
    }
    setPretForm(pretFormVide);
  };

  const editerPret = (p: Pret) => {
    setPretEnEditionId(p.id);
    setPretForm({ montant: p.montant, dateDebut: p.dateDebut, duree: p.duree, jourEcheance: p.jourEcheance, taux: p.taux, fraisDivers: p.fraisDivers, differeJusquaPretId: p.differeJusquaPretId });
    setModalePretId(null);
  };

  const annulerEditionPret = () => {
    setPretEnEditionId(null);
    setPretForm(pretFormVide);
  };

  const supprimerPret = (id: number) => {
    setPrets(prets.filter((p) => p.id !== id));
    if (modalePretId === id) setModalePretId(null);
    if (pretEnEditionId === id) { setPretEnEditionId(null); setPretForm(pretFormVide); }
  };

  const pretEnModal = prets.find((p) => p.id === modalePretId) ?? null;
  const lignesPret = pretEnModal ? lignesPourPret(pretEnModal) : [];

  const [ongletFiscal, setOngletFiscal] = useState<'2033-A' | '2033-B' | '2033-C'>('2033-B');
  const [anneeFiscale, setAnneeFiscale] = useState<number>(new Date().getFullYear() - 1);
  const [resultat2033B, setResultat2033B] = useState<number>(0);

  // Capital restant dû fin d'exercice N = somme du capital restant après la dernière mensualité de l'année N de chaque prêt
  const capitalRestantFinN = prets.reduce((total, p) => {
    const lpret = lignesPourPret(p);
    const lignesAvantFinN = lpret.filter(l => parseInt(l.date.split('-')[0]) <= anneeFiscale);
    if (lignesAvantFinN.length === 0) return total; // prêt pas encore démarré
    return total + lignesAvantFinN[lignesAvantFinN.length - 1].capitalRestant;
  }, 0);

  // Capital restant dû au 31/12 de l'année N+1 (dettes à plus d'un an)
  const capitalRestantFinNplus1 = prets.reduce((total, p) => {
    const lpret = lignesPourPret(p);
    const lignesAvantFinNplus1 = lpret.filter(l => parseInt(l.date.split('-')[0]) <= anneeFiscale + 1);
    if (lignesAvantFinNplus1.length === 0) return total;
    return total + lignesAvantFinNplus1[lignesAvantFinNplus1.length - 1].capitalRestant;
  }, 0);

  // Total des intérêts payés sur tous les emprunts pour l'année fiscale sélectionnée
  const chargesFinCalc = prets.reduce((total, pret) => {
    return total + lignesPourPret(pret)
      .filter(l => new Date(l.date).getFullYear() === anneeFiscale)
      .reduce((s, l) => s + l.interets, 0);
  }, 0);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBien({ ...bien, [e.target.name]: e.target.value });
  };

  const formulaireComplet =
    bien.montantAchat !== "" &&
    bien.dureeAmortissement !== "" &&
    bien.premiereAnneeExercice !== "" &&
    bien.datePremiereMiseEnLocation !== "";

  const lignes = useMemo<LigneAmortissement[]>(() => {
    if (!formulaireComplet) return [];
    const montant = parseFloat(bien.montantAchat);
    const duree = parseInt(bien.dureeAmortissement);
    const annee = parseInt(bien.premiereAnneeExercice);
    const [y, m, d] = bien.datePremiereMiseEnLocation.split("-").map(Number);
    const dateLocation = new Date(y, m - 1, d);

    if (
      isNaN(montant) || isNaN(duree) || isNaN(annee) ||
      montant <= 0 || duree <= 0 ||
      dateLocation.getFullYear() !== annee
    ) return [];

    return calculerAmortissements(montant, duree, annee, dateLocation);
  }, [bien, formulaireComplet]);

  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Titre */}
        <div className="mb-4 text-center">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
            Déclaration LMNP
          </h1>
          <p className="mt-2 text-slate-500 text-sm">
            Loueur Meublé Non Professionnel — Calcul automatique
          </p>
        </div>

        {/* Formulaire */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-8">

          {/* Section : Bien immobilier */}
          <section>
            <h2 className="text-lg font-semibold text-slate-700 mb-5 pb-2 border-b border-slate-100">
              Bien immobilier
            </h2>
            <div className="space-y-5">
              <div>
                <label htmlFor="montantAchat" className="block text-sm font-medium text-slate-600 mb-1.5">
                  Montant d'achat (frais de notaire inclus)
                </label>
                <div className="relative">
                  <input
                    id="montantAchat"
                    name="montantAchat"
                    type="number"
                    min="0"
                    step="1"
                    value={bien.montantAchat}
                    onChange={handleChange}
                    placeholder="ex : 200 000"
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 pr-10 text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400 text-sm">€</span>
                </div>
              </div>
              <div>
                <label htmlFor="dureeAmortissement" className="block text-sm font-medium text-slate-600 mb-1.5">
                  Durée d'amortissement
                </label>
                <div className="relative">
                  <input
                    id="dureeAmortissement"
                    name="dureeAmortissement"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={bien.dureeAmortissement}
                    onChange={handleChange}
                    placeholder="ex : 30"
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 pr-12 text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400 text-sm">ans</span>
                </div>
              </div>
            </div>
          </section>

          {/* Section : Exercice LMNP */}
          <section>
            <h2 className="text-lg font-semibold text-slate-700 mb-5 pb-2 border-b border-slate-100">
              Exercice LMNP
            </h2>
            <div className="space-y-5">
              <div>
                <label htmlFor="premiereAnneeExercice" className="block text-sm font-medium text-slate-600 mb-1.5">
                  Première année d'exercice LMNP
                </label>
                <input
                  id="premiereAnneeExercice"
                  name="premiereAnneeExercice"
                  type="number"
                  min="2000"
                  max="2100"
                  step="1"
                  value={bien.premiereAnneeExercice}
                  onChange={handleChange}
                  placeholder="ex : 2023"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>
              <div>
                <label htmlFor="datePremiereMiseEnLocation" className="block text-sm font-medium text-slate-600 mb-1.5">
                  Date de 1<sup>ère</sup> mise en location LMNP
                </label>
                <input
                  id="datePremiereMiseEnLocation"
                  name="datePremiereMiseEnLocation"
                  type="date"
                  value={bien.datePremiereMiseEnLocation}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>
            </div>
          </section>

        </div>

        {/* Tableau amortissements — visible uniquement si formulaire complet */}
        {formulaireComplet && lignes.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {/* En-tête dépliable */}
            <button
              type="button"
              onClick={() => setTableauOuvert((o) => !o)}
              className="w-full flex items-center justify-between px-8 py-5 text-left hover:bg-slate-50 transition"
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-700">
                  Tableau d'amortissement
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lignes.length} exercice{lignes.length > 1 ? "s" : ""} —{" "}
                  {formatEur(parseFloat(bien.montantAchat))} sur {bien.dureeAmortissement} ans
                </p>
              </div>
              <svg
                className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${tableauOuvert ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Corps du tableau */}
            {tableauOuvert && (
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                      <th className="px-5 py-3 text-left font-medium">Année</th>
                      <th className="px-5 py-3 text-center font-medium">N° exercice</th>
                      <th className="px-5 py-3 text-right font-medium">Amort. début de période</th>
                      <th className="px-5 py-3 text-right font-medium">Amort. de la période</th>
                      <th className="px-5 py-3 text-right font-medium">Amort. fin de période</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lignes.map((ligne, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === lignes.length - 1;
                      const isPartiel = isFirst || (isLast && lignes.length > parseInt(bien.dureeAmortissement));
                      return (
                        <tr
                          key={ligne.annee}
                          className={`${isPartiel ? "bg-indigo-50/40" : "hover:bg-slate-50"} transition-colors`}
                        >
                          <td className="px-5 py-3 font-medium text-slate-700">
                            {ligne.annee}
                            {isPartiel && (
                              <span className="ml-2 text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">
                                pro rata
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-center text-slate-500">{ligne.numeroExercice}</td>
                          <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{formatEur(ligne.debutPeriode)}</td>
                          <td className="px-5 py-3 text-right font-medium text-slate-800 tabular-nums">{formatEur(ligne.amortissementPeriode)}</td>
                          <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{formatEur(ligne.finPeriode)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Total */}
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Total amorti
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">
                        {formatEur(lignes.reduce((s, l) => s + l.amortissementPeriode, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Section loyers perçus */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-8 py-5 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-700">Loyers perçus</h2>
          </div>

          {/* Formulaire d'ajout */}
          <form onSubmit={ajouterLoyer} className="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex flex-col gap-1 w-28">
                <label htmlFor="exercice" className="text-xs font-medium text-slate-500">Année</label>
                <input
                  id="exercice"
                  name="exercice"
                  type="number"
                  min="2000"
                  max="2100"
                  step="1"
                  value={loyerForm.exercice}
                  onChange={handleLoyerChange}
                  placeholder="ex : 2023"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>
              <div className="flex flex-col gap-1 w-32">
                <label htmlFor="nombreMois" className="text-xs font-medium text-slate-500">Nombre de mois</label>
                <input
                  id="nombreMois"
                  name="nombreMois"
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  value={loyerForm.nombreMois}
                  onChange={handleLoyerChange}
                  placeholder="ex : 12"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-36">
                <label htmlFor="loyerMensuel" className="text-xs font-medium text-slate-500">Loyer mensuel</label>
                <div className="relative">
                  <input
                    id="loyerMensuel"
                    name="loyerMensuel"
                    type="number"
                    min="0"
                    step="0.01"
                    value={loyerForm.loyerMensuel}
                    onChange={handleLoyerChange}
                    placeholder="ex : 850"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400 text-xs">€</span>
                </div>
              </div>
              <button
                type="submit"
                className="h-[38px] px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800 transition whitespace-nowrap"
              >
                + Ajouter
              </button>
            </div>
          </form>

          {/* Tableau des loyers */}
          {loyers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-center font-medium">Année</th>
                    <th className="px-5 py-3 text-center font-medium">Nb de mois</th>
                    <th className="px-5 py-3 text-right font-medium">Loyer mensuel</th>
                    <th className="px-5 py-3 text-right font-medium">Total annuel</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loyers.map((l) => {
                    const total = parseFloat(l.loyerMensuel) * parseInt(l.nombreMois);
                    return (
                      <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 text-center font-medium text-slate-700">{l.exercice}</td>
                        <td className="px-5 py-3 text-center text-slate-500">{l.nombreMois}</td>
                        <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{formatEur(parseFloat(l.loyerMensuel))}</td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-800 tabular-nums">{formatEur(total)}</td>
                        <td className="px-5 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => supprimerLoyer(l.id)}
                            className="text-slate-300 hover:text-red-400 transition"
                            title="Supprimer"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Total loyers perçus
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">
                      {formatEur(loyers.reduce((s, l) => s + parseFloat(l.loyerMensuel) * parseInt(l.nombreMois), 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="px-8 py-6 text-sm text-slate-400 text-center">
              Aucun loyer saisi — utilisez le formulaire ci-dessus pour en ajouter.
            </p>
          )}
        </div>

        {/* Section dépenses */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-8 py-5 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-700">Dépenses</h2>
          </div>

          {/* Formulaire d'ajout */}
          <form onSubmit={ajouterDepense} className="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
            <datalist id="types-depenses">
              <option value="Impôts" />
              <option value="Travaux" />
              <option value="Autres" />
            </datalist>

            <div className="flex gap-3 items-end flex-wrap">
              {/* Année */}
              <div className="flex flex-col gap-1 w-28">
                <label htmlFor="dep-annee" className="text-xs font-medium text-slate-500">Année</label>
                <input
                  id="dep-annee"
                  name="annee"
                  type="number"
                  min="2000"
                  max="2100"
                  step="1"
                  value={depenseForm.annee}
                  onChange={handleDepenseChange}
                  placeholder="ex : 2025"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>

              {/* Type */}
              <div className="flex flex-col gap-1 w-44">
                <label htmlFor="dep-type" className="text-xs font-medium text-slate-500">Type</label>
                <input
                  id="dep-type"
                  name="type"
                  list="types-depenses"
                  value={depenseForm.type}
                  onChange={handleDepenseChange}
                  placeholder="ex : Travaux"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>

              {/* Montant */}
              <div className="flex flex-col gap-1 w-36">
                <label htmlFor="dep-montant" className="text-xs font-medium text-slate-500">Montant</label>
                <div className="relative">
                  <input
                    id="dep-montant"
                    name="montant"
                    type="number"
                    min="0"
                    step="0.01"
                    value={depenseForm.montant}
                    onChange={handleDepenseChange}
                    placeholder="ex : 1 200"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400 text-xs">€</span>
                </div>
              </div>

              {/* Commentaire */}
              <div className="flex flex-col gap-1 flex-1 min-w-40">
                <label htmlFor="dep-commentaire" className="text-xs font-medium text-slate-500">Commentaire</label>
                <input
                  id="dep-commentaire"
                  name="commentaire"
                  type="text"
                  value={depenseForm.commentaire}
                  onChange={handleDepenseChange}
                  placeholder="Optionnel"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>

              <button
                type="submit"
                className="h-[38px] px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800 transition whitespace-nowrap"
              >
                + Ajouter
              </button>
            </div>
          </form>

          {/* Tableau des dépenses */}
          {depenses.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-center font-medium">Année</th>
                    <th className="px-5 py-3 text-left font-medium">Type</th>
                    <th className="px-5 py-3 text-right font-medium">Montant</th>
                    <th className="px-5 py-3 text-left font-medium">Commentaire</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {depenses.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 text-center font-medium text-slate-700">{d.annee}</td>
                      <td className="px-5 py-3 text-slate-700">{d.type}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-800 tabular-nums">{formatEur(parseFloat(d.montant))}</td>
                      <td className="px-5 py-3 text-slate-400 italic text-xs">{d.commentaire || "—"}</td>
                      <td className="px-5 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => supprimerDepense(d.id)}
                          className="text-slate-300 hover:text-red-400 transition"
                          title="Supprimer"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={2} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Total dépenses
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">
                      {formatEur(depenses.reduce((s, d) => s + parseFloat(d.montant), 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="px-8 py-6 text-sm text-slate-400 text-center">
              Aucune dépense saisie — utilisez le formulaire ci-dessus pour en ajouter.
            </p>
          )}
        </div>

        {/* Section prêts */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-8 py-5 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-700">Prêts</h2>
          </div>

          {/* Formulaire d'ajout / modification */}
          <form onSubmit={soumettreFormPret} className={`px-8 py-5 border-b border-slate-100 transition-colors ${pretEnEditionId !== null ? "bg-amber-50/60" : "bg-slate-50/50"}`}>
            <div className="flex gap-3 items-end flex-wrap">
              {/* Montant */}
              <div className="flex flex-col gap-1 w-36">
                <label htmlFor="pret-montant" className="text-xs font-medium text-slate-500">Montant emprunté</label>
                <div className="relative">
                  <input
                    id="pret-montant" name="montant" type="number" min="0" step="1"
                    value={pretForm.montant} onChange={handlePretChange} placeholder="150 000"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400 text-xs">€</span>
                </div>
              </div>

              {/* Date de début */}
              <div className="flex flex-col gap-1 w-38">
                <label htmlFor="pret-dateDebut" className="text-xs font-medium text-slate-500">Date de début</label>
                <input
                  id="pret-dateDebut" name="dateDebut" type="date"
                  value={pretForm.dateDebut} onChange={handlePretChange}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>

              {/* Durée */}
              <div className="flex flex-col gap-1 w-24">
                <label htmlFor="pret-duree" className="text-xs font-medium text-slate-500">Durée</label>
                <div className="relative">
                  <input
                    id="pret-duree" name="duree" type="number" min="1" max="30" step="1"
                    value={pretForm.duree} onChange={handlePretChange} placeholder="20"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400 text-xs">ans</span>
                </div>
              </div>

              {/* Jour échéance */}
              <div className="flex flex-col gap-1 w-24">
                <label htmlFor="pret-jour" className="text-xs font-medium text-slate-500">Jour échéance</label>
                <input
                  id="pret-jour" name="jourEcheance" type="number" min="1" max="28" step="1"
                  value={pretForm.jourEcheance} onChange={handlePretChange}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                />
              </div>

              {/* Taux */}
              <div className="flex flex-col gap-1 w-28">
                <label htmlFor="pret-taux" className="text-xs font-medium text-slate-500">Taux annuel</label>
                <div className="relative">
                  <input
                    id="pret-taux" name="taux" type="number" min="0" step="0.01"
                    value={pretForm.taux} onChange={handlePretChange} placeholder="3.50"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-7 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400 text-xs">%</span>
                </div>
              </div>

              {/* Frais divers */}
              <div className="flex flex-col gap-1 w-32">
                <label htmlFor="pret-frais" className="text-xs font-medium text-slate-500">Frais divers / mois</label>
                <div className="relative">
                  <input
                    id="pret-frais" name="fraisDivers" type="number" min="0" step="0.01"
                    value={pretForm.fraisDivers} onChange={handlePretChange} placeholder="0"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400 text-xs">€</span>
                </div>
              </div>

              <div className="flex gap-2 items-end">
                <button
                  type="submit"
                  className={`h-[38px] px-4 rounded-lg text-white text-sm font-medium transition whitespace-nowrap ${pretEnEditionId !== null ? "bg-amber-500 hover:bg-amber-600 active:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800"}`}
                >
                  {pretEnEditionId !== null ? "Enregistrer" : "+ Ajouter"}
                </button>
                {pretEnEditionId !== null && (
                  <button
                    type="button"
                    onClick={annulerEditionPret}
                    className="h-[38px] px-4 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 transition whitespace-nowrap"
                  >
                    Annuler
                  </button>
                )}
              </div>
            </div>

            {/* Option différé — visible seulement s'il existe d'autres prêts */}
            {prets.filter((p) => pretEnEditionId === null || p.id !== pretEnEditionId).length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-200 flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={pretForm.differeJusquaPretId !== ""}
                    onChange={(e) =>
                      setPretForm({
                        ...pretForm,
                        differeJusquaPretId: e.target.checked
                          ? String(prets.filter((p) => pretEnEditionId === null || p.id !== pretEnEditionId)[0].id)
                          : "",
                      })
                    }
                    className="w-4 h-4 rounded border-slate-300 accent-indigo-600"
                  />
                  Commencer l'amortissement seulement après remboursement du prêt :
                </label>
                {pretForm.differeJusquaPretId !== "" && (
                  <select
                    name="differeJusquaPretId"
                    value={pretForm.differeJusquaPretId}
                    onChange={handlePretChange}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
                  >
                    {prets
                      .filter((p) => pretEnEditionId === null || p.id !== pretEnEditionId)
                      .map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {formatEur(parseFloat(p.montant))} — {p.taux}% — {p.duree} ans (début {formatDate(p.dateDebut)})
                        </option>
                      ))}
                  </select>
                )}
              </div>
            )}
          </form>

          {/* Tableau des prêts */}
          {prets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-right font-medium">Montant</th>
                    <th className="px-5 py-3 text-center font-medium">Date début</th>
                    <th className="px-5 py-3 text-center font-medium">Durée</th>
                    <th className="px-5 py-3 text-center font-medium">Taux</th>
                    <th className="px-5 py-3 text-right font-medium">Mensualité</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prets.map((p) => {
                    const lignes = lignesPourPret(p);
                    const mensualite = lignes[0]?.echeance ?? 0;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 text-right font-semibold text-slate-800 tabular-nums">{formatEur(parseFloat(p.montant))}</td>
                        <td className="px-5 py-3 text-center text-slate-600">
                          {formatDate(p.dateDebut)}
                          {p.differeJusquaPretId && (
                            <span className="ml-2 text-[10px] font-semibold text-orange-400 uppercase tracking-wide">différé</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-center text-slate-500">{p.duree} ans</td>
                        <td className="px-5 py-3 text-center text-slate-500">{p.taux} %</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatEur(mensualite)}</td>
                        <td className="px-5 py-3 flex items-center gap-3 justify-end">
                          <button
                            type="button"
                            onClick={() => setModalePretId(p.id)}
                            className="text-xs font-medium text-indigo-500 hover:text-indigo-700 transition"
                            title="Voir le tableau d'amortissement"
                          >
                            Tableau
                          </button>
                          <button
                            type="button"
                            onClick={() => editerPret(p)}
                            className="text-xs font-medium text-amber-500 hover:text-amber-700 transition"
                            title="Modifier"
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => supprimerPret(p.id)}
                            className="text-slate-300 hover:text-red-400 transition"
                            title="Supprimer"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-8 py-6 text-sm text-slate-400 text-center">
              Aucun prêt saisi — utilisez le formulaire ci-dessus pour en ajouter.
            </p>
          )}
        </div>

        {/* ── Séparateur ── */}
        <div className="flex items-center gap-4 pt-4">
          <div className="flex-1 border-t-2 border-slate-300" />
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-2">
            Formulaires fiscaux
          </span>
          <div className="flex-1 border-t-2 border-slate-300" />
        </div>

        {/* ── Encart soutien ── */}
        <div className="flex items-center justify-center">
          <a
            href="https://buymeacoffee.com/lmnpow"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-800 shadow-sm hover:bg-yellow-100 transition"
          >
            <span>☕</span>
            <span>Cet outil vous aide ? Offrez-moi un café !</span>
          </a>
        </div>

        {/* ── Sélecteur d'année fiscale ── */}
        <div className="flex items-center justify-center gap-3">
          <label className="text-xs font-medium text-slate-500">Année fiscale de la déclaration</label>
          <select
            value={anneeFiscale}
            onChange={e => setAnneeFiscale(parseInt(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
          >
            {(() => {
              const debut = parseInt(bien.premiereAnneeExercice) || new Date().getFullYear() - 1;
              const fin = new Date().getFullYear();
              return Array.from({ length: Math.max(1, fin - debut + 1) }, (_, i) => debut + i).map(a => (
                <option key={a} value={a}>{a}</option>
              ));
            })()}
          </select>
        </div>

        {/* ── Onglets 2033 ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

          {/* Barre d'onglets */}
          <div className="flex bg-[#d6d6d6] border-b border-[#b0b0b0]">
            {(['2033-A', '2033-B', '2033-C'] as const).map((onglet) => (
              <button
                key={onglet}
                type="button"
                onClick={() => setOngletFiscal(onglet)}
                className={`px-6 py-2 text-xs font-bold transition-colors border-r border-[#b0b0b0] last:border-r-0 ${
                  ongletFiscal === onglet
                    ? 'bg-white text-slate-800'
                    : 'text-slate-600 hover:bg-[#c8c8c8]'
                }`}
              >
                {onglet}
              </button>
            ))}
          </div>

          {/* ─── 2033-A ─── */}
          <div className={`font-sans text-sm${ongletFiscal === '2033-A' ? '' : ' hidden'}`}>
            <EnTeteFormulaire
              titre="Bilan simplifié de l'exercice"
              numero="N° 2033-A"
            />
            <Form2033A
              montantAchat={bien.montantAchat}
              lignes={lignes}
              anneeFiscale={anneeFiscale}
              capitalRestantFinN={capitalRestantFinN}
              capitalRestantFinNplus1={capitalRestantFinNplus1}
              resultatExploitation={resultat2033B}
            />
          </div>

          {/* ─── 2033-B ─── */}
          <div className={`font-sans text-sm${ongletFiscal === '2033-B' ? '' : ' hidden'}`}>
            <EnTeteFormulaire
              titre="Compte de résultat simplifié de l'exercice"
              numero="N° 2033-B"
            />
            <Form2033B
              loyers={loyers}
              depenses={depenses}
              anneeFiscale={anneeFiscale}
              lignes={lignes}
              chargesFinCalc={chargesFinCalc}
              onResultatChange={setResultat2033B}
            />
          </div>

          {/* ─── 2033-C ─── */}
          <div className={`font-sans text-sm${ongletFiscal === '2033-C' ? '' : ' hidden'}`}>
            <EnTeteFormulaire
              titre="Immobilisations, amortissements, provisions, amortissements dérogatoires"
              numero="N° 2033-C"
            />
            <Form2033C
              montantAchat={bien.montantAchat}
              premiereAnnee={bien.premiereAnneeExercice}
              anneeFiscale={anneeFiscale}
              lignes={lignes}
            />
          </div>

        </div>

      </div>

      {/* Modale tableau d'amortissement du prêt */}
      {modalePretId !== null && pretEnModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setModalePretId(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* En-tête modale */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Tableau d'amortissement du prêt
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatEur(parseFloat(pretEnModal.montant))} — {pretEnModal.taux}% — {pretEnModal.duree} ans
                  — échéances le {pretEnModal.jourEcheance} du mois
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalePretId(null)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tableau scrollable */}
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="text-slate-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-center font-medium">N°</th>
                    <th className="px-4 py-3 text-center font-medium">Date</th>
                    <th className="px-4 py-3 text-right font-medium">Amortissement</th>
                    <th className="px-4 py-3 text-right font-medium">Intérêts</th>
                    <th className="px-4 py-3 text-right font-medium">Frais divers</th>
                    <th className="px-4 py-3 text-right font-medium">Échéance</th>
                    <th className="px-4 py-3 text-right font-medium">Capital restant dû</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lignesPret.map((l) => (
                    <tr key={l.numero} className={`transition-colors ${l.isDiffere ? "bg-orange-50/60" : "hover:bg-slate-50"}`}>
                      <td className="px-4 py-2.5 text-center text-slate-400 tabular-nums">{l.numero}</td>
                      <td className="px-4 py-2.5 text-center text-slate-600">
                        {formatDate(l.date)}
                        {l.isDiffere && <span className="ml-1.5 text-[9px] font-semibold text-orange-400 uppercase tracking-wide">différé</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatEur(l.amortissement)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatEur(l.interets)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatEur(l.fraisDivers)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{formatEur(l.echeance)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatEur(l.capitalRestant)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={2} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">
                      {formatEur(lignesPret.reduce((s, l) => s + l.amortissement, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">
                      {formatEur(lignesPret.reduce((s, l) => s + l.interets, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">
                      {formatEur(lignesPret.reduce((s, l) => s + l.fraisDivers, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">
                      {formatEur(lignesPret.reduce((s, l) => s + l.echeance, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
