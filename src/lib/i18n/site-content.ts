import type { Locale } from "@/lib/i18n/locale";

/**
 * Translation content for the public site and the quote-request flow.
 *
 * One key set, two content objects — never two copies of a page component.
 * The Italian copy is the source of truth and is written as natural
 * commercial Italian, not translated from English.
 *
 * `SiteCopy` is derived from the Italian object, so adding a key to `it`
 * without adding it to `en` is a TypeScript error rather than a silently
 * half-translated page.
 */

const it = {
  // --- global / nav ---------------------------------------------------
  siteName: "GommaRush",
  menuOpen: "Apri il menu",
  menuClose: "Chiudi il menu",
  menuTitle: "Menu",
  navHome: "Home",
  navQuote: "Richiedi un'offerta",
  navDriver: "Area autisti",
  navAdmin: "Area riservata",
  language: "Lingua",
  backToHome: "Torna alla home",
  back: "Indietro",

  // --- hero -----------------------------------------------------------
  heroTitle: "Il partner affidabile per la fornitura di pneumatici alla tua attività",
  // Reso come <h2> nell'hero: è il secondo livello di intestazione della
  // pagina e porta il messaggio sull'area servita.
  heroSubtitle:
    "Consegne rapide per gommisti e officine in tutta la provincia di Vicenza e fino a 50 km oltre. Esperienza, affidabilità e un servizio costruito per creare partnership solide e durature.",
  heroCta: "Richiedi un'offerta",

  // --- marche -----------------------------------------------------------
  brandsTitle: "Le marche che forniamo",
  brandsAriaLabel: "Marche di pneumatici fornite",

  // --- why ------------------------------------------------------------
  whyTitle: "Perché GommaRush?",
  whyReliableTitle: "Un partner affidabile",
  whyReliableBody: "Rispondiamo in fretta e manteniamo gli impegni presi.",
  whyFastTitle: "Pneumatici quando ti servono",
  whyFastBody: "Consegne in 24 ore o entro 7 giorni, decidi tu.",
  whyPriceTitle: "Prezzi competitivi",
  whyPriceBody: "Cerchiamo la soluzione migliore per ogni richiesta.",

  // --- quote page -----------------------------------------------------
  quoteTitle: "Richiedi un'offerta",
  quoteIntro:
    "Aggiungi i prodotti che ti servono e ti invieremo la nostra migliore offerta.",
  productType: "Tipo prodotto",
  tyre: "Pneumatico",
  otherProduct: "Altro prodotto",
  dimensions: "Dimensioni",
  width: "Larghezza",
  profile: "Spalla",
  rim: "Cerchio",
  loadSpeedIndex: "Indice carico/velocità",
  loadSpeedPlaceholder: "es. 91V",
  optional: "Opzionale",
  quantity: "Quantità",
  decrease: "Diminuisci",
  increase: "Aumenta",
  preference: "Preferenza",
  bestPrice: "Miglior prezzo",
  specificBrand: "Marca specifica",
  brand: "Marca",
  brandPlaceholder: "es. Michelin, Pirelli, Continental",
  productDescription: "Prodotto / descrizione",
  productDescriptionPlaceholder: "es. valvole TR414, sensore TPMS, cerchio…",
  whenNeeded: "Quando ti serve?",
  within24h: "24 ore",
  within7d: "7 giorni",
  add: "Aggiungi",
  addAnother: "Aggiungi un altro prodotto",
  edit: "Modifica",
  remove: "Rimuovi",
  cancel: "Annulla",
  itemRemoved: "Prodotto rimosso",
  undo: "Annulla",
  pieces: "pz",

  // --- contact --------------------------------------------------------
  yourDetails: "I tuoi dati",
  company: "Azienda",
  companyPlaceholder: "es. Gomme Rossi SRL",
  email: "Email",
  emailHelp: "Invieremo l'offerta a questo indirizzo email.",
  emailPlaceholder: "es. acquisti@gommerossi.it",
  whatsappTitle: "Ricevi l'offerta anche su WhatsApp",
  whatsappAdd: "+ Aggiungi numero WhatsApp",
  whatsappLabel: "Numero WhatsApp",
  whatsappRemove: "Rimuovi numero",
  submit: "Richiedi l'offerta",
  submitting: "Invio in corso…",

  // --- validation -----------------------------------------------------
  errRequired: "Campo obbligatorio",
  errWidth: "Larghezza non valida",
  errProfile: "Spalla non valida",
  errRim: "Cerchio non valido",
  errDescription: "Descrivi il prodotto che ti serve",
  errBrand: "Indica almeno una marca",
  errDelivery: "Scegli quando ti serve",
  errQuantity: "La quantità deve essere almeno 1",
  errCompany: "Inserisci il nome della tua azienda",
  errEmail: "Inserisci un indirizzo email valido",
  errWhatsapp: "Numero di telefono non valido",
  errNoItems: "Aggiungi almeno un prodotto alla richiesta",
  errItemIncomplete: "Completa o rimuovi il prodotto che stai modificando",

  // --- submission -----------------------------------------------------
  seasonLabel: "Stagione",
  seasonAny: "Indifferente",
  seasonSummer: "Estivo",
  seasonWinter: "Invernale",
  seasonAllSeason: "Quattro stagioni",
  notesLabel: "Note aggiuntive",
  notesHint: "Facoltativo — orari di consegna, riferimenti, richieste particolari.",
  notesPlaceholder: "Es. consegna al magazzino sul retro, dal lunedì al venerdì.",
  successReferenceLabel: "Riferimento",
  successTitle: "Richiesta inviata",
  successBodyPrefix:
    "Abbiamo ricevuto la tua richiesta di offerta. Ti contatteremo al più presto all'indirizzo email indicato:",
  successWhatsapp: "Riceverai l'offerta anche su WhatsApp al numero",
  successRequestLabel: "Richiesta",
  successNewRequest: "Invia un'altra richiesta",
  failTitle: "Non siamo riusciti a inviare la richiesta.",
  failBody: "Riprova tra qualche istante. I dati che hai inserito sono stati conservati.",
  retry: "Riprova",
} as const;

export type SiteCopyKey = keyof typeof it;
export type SiteCopy = Record<SiteCopyKey, string>;

const en: SiteCopy = {
  siteName: "GommaRush",
  menuOpen: "Open menu",
  menuClose: "Close menu",
  menuTitle: "Menu",
  navHome: "Home",
  navQuote: "Request an offer",
  navDriver: "Driver area",
  navAdmin: "Staff area",
  language: "Language",
  backToHome: "Back to home",
  back: "Back",

  heroTitle: "The dependable partner for your business's tyre supply",
  heroSubtitle:
    "Fast delivery for tyre shops and garages across the whole province of Vicenza and up to 50 km beyond. Experience, reliability and a service built for solid, lasting partnerships.",
  heroCta: "Request an offer",

  brandsTitle: "The brands we supply",
  brandsAriaLabel: "Tyre brands supplied",

  whyTitle: "Why GommaRush?",
  whyReliableTitle: "A partner you can rely on",
  whyReliableBody: "We answer quickly and we keep to what we agree.",
  whyFastTitle: "Tyres when you need them",
  whyFastBody: "Delivery within 24 hours or 7 days — your choice.",
  whyPriceTitle: "Competitive pricing",
  whyPriceBody: "We look for the best option on every request.",

  quoteTitle: "Request an offer",
  quoteIntro: "Add the products you need and we'll send you our best offer.",
  productType: "Product type",
  tyre: "Tyre",
  otherProduct: "Other product",
  dimensions: "Dimensions",
  width: "Width",
  profile: "Profile",
  rim: "Rim",
  loadSpeedIndex: "Load/speed index",
  loadSpeedPlaceholder: "e.g. 91V",
  optional: "Optional",
  quantity: "Quantity",
  decrease: "Decrease",
  increase: "Increase",
  preference: "Preference",
  bestPrice: "Best price",
  specificBrand: "Specific brand",
  brand: "Brand",
  brandPlaceholder: "e.g. Michelin, Pirelli, Continental",
  productDescription: "Product / description",
  productDescriptionPlaceholder: "e.g. TR414 valves, TPMS sensor, rim…",
  whenNeeded: "When do you need it?",
  within24h: "24 hours",
  within7d: "7 days",
  add: "Add",
  addAnother: "Add another product",
  edit: "Edit",
  remove: "Remove",
  cancel: "Cancel",
  itemRemoved: "Product removed",
  undo: "Undo",
  pieces: "pcs",

  yourDetails: "Your details",
  company: "Company",
  companyPlaceholder: "e.g. Gomme Rossi SRL",
  email: "Email",
  emailHelp: "We'll send the offer to this email address.",
  emailPlaceholder: "e.g. purchasing@gommerossi.it",
  whatsappTitle: "Also receive the offer on WhatsApp",
  whatsappAdd: "+ Add WhatsApp number",
  whatsappLabel: "WhatsApp number",
  whatsappRemove: "Remove number",
  submit: "Request the offer",
  submitting: "Sending…",

  errRequired: "This field is required",
  errWidth: "Invalid width",
  errProfile: "Invalid profile",
  errRim: "Invalid rim",
  errDescription: "Describe the product you need",
  errBrand: "Enter at least one brand",
  errDelivery: "Choose when you need it",
  errQuantity: "Quantity must be at least 1",
  errCompany: "Enter your company name",
  errEmail: "Enter a valid email address",
  errWhatsapp: "Invalid phone number",
  errNoItems: "Add at least one product to your request",
  errItemIncomplete: "Finish or remove the product you're editing",

  seasonLabel: "Season",
  seasonAny: "No preference",
  seasonSummer: "Summer",
  seasonWinter: "Winter",
  seasonAllSeason: "All season",
  notesLabel: "Additional notes",
  notesHint: "Optional — delivery times, references, anything specific.",
  notesPlaceholder: "E.g. deliver to the rear warehouse, Monday to Friday.",
  successReferenceLabel: "Reference",
  successTitle: "Request sent",
  successBodyPrefix:
    "We've received your quote request. We'll get back to you shortly at the email address you gave us:",
  successWhatsapp: "You'll also receive the offer on WhatsApp at",
  successRequestLabel: "Request",
  successNewRequest: "Send another request",
  failTitle: "We couldn't send your request.",
  failBody: "Please try again in a moment. Everything you entered has been kept.",
  retry: "Try again",
};

const DICTIONARIES: Record<Locale, SiteCopy> = { it, en };

export function getCopy(locale: Locale): SiteCopy {
  return DICTIONARIES[locale] ?? DICTIONARIES.it;
}
