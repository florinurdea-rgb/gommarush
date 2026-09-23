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

  // --- trova pneumatico -------------------------------------------------
  finderCta: "Trova il tuo pneumatico",
  finderTitle: "Trova il tuo pneumatico",
  finderIntro:
    "Inserisci il codice a barre (EAN) o il codice del produttore stampato sul pneumatico.",
  finderLabel: "Codice pneumatico",
  finderPlaceholder: "es. 4717622044652",
  finderSubmit: "Cerca",
  finderSearching: "Ricerca in corso…",
  finderNewSearch: "Cerca un altro codice",
  finderClose: "Chiudi",
  finderResultsOne: "Trovato 1 pneumatico",
  finderResultsMany: "Trovati {count} pneumatici",
  finderEmptyTitle: "Nessun pneumatico trovato",
  finderEmptyBody:
    "Questo codice non è presente nel nostro catalogo. Controlla le cifre oppure richiedi un'offerta e ci pensiamo noi.",
  finderInvalidTitle: "Codice non valido",
  finderInvalidBody:
    "Le cifre inserite non formano un codice a barre valido. Ricontrolla il codice sul pneumatico.",
  finderErrorTitle: "Ricerca non riuscita",
  finderErrorBody: "Riprova tra qualche istante.",
  finderRateLimited:
    "Troppe ricerche in poco tempo. Attendi qualche minuto e riprova.",
  finderMatchedOnEan: "Trovato tramite codice a barre",
  finderMatchedOnManufacturer: "Trovato tramite codice produttore",
  finderSpecSize: "Misura",
  finderSpecLoadSpeed: "Indice di carico / velocità",
  finderSpecSeason: "Stagione",
  finderSpecClass: "Categoria",
  finderSpecWeight: "Peso",
  finderSpecEprel: "Codice EPREL",
  finderSpecXl: "Rinforzato (XL)",
  finderSpecRunFlat: "Run-flat",
  finderYes: "Sì",
  finderNo: "No",
  finderUnknownWeight: "Non comunicato",
  finderSeasonSummer: "Estivo",
  finderSeasonWinter: "Invernale",
  finderSeasonAllSeason: "Quattro stagioni",
  finderClassPassengerCar: "Autovettura",
  finderClassPassengerCarRunflat: "Autovettura run-flat",
  finderClassSuv4x4: "SUV / 4x4",
  finderClassLightTruckVan: "Furgone / trasporto leggero",
  finderClassMotorcycle: "Motociclo",
  finderClassScooter: "Scooter",
  finderClassOldDot: "DOT datato",
  finderClassSpare: "Ruotino di scorta",

  // --- marche -----------------------------------------------------------
  brandsTitle: "Le marche che forniamo",
  brandsAriaLabel: "Marche di pneumatici fornite",

  // --- why ------------------------------------------------------------
  whyTitle: "Perché GommaRush?",
  whyReliableTitle: "Un partner affidabile",
  whyReliableBody: "Rispondiamo in fretta e manteniamo gli impegni presi.",
  whyFastTitle: "Pneumatici quando ti servono",
  whyFastBody: "Consegne in 48 ore o entro 7 giorni, decidi tu.",
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
  within48h: "48 ore",
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

  // --- nav / CTA (redesign) ---------------------------------------------
  navTyres: "Pneumatici",
  navHowItWorks: "Come funziona",
  navWhy: "Perch\u00e9 GommaRush",
  navSuppliers: "Per fornitori",
  navClientArea: "Area clienti",
  ctaRegister: "Registrati",
  ctaRegisterFree: "Registrati gratuitamente",
  ctaDiscoverHow: "Scopri come funziona",
  ctaTalk: "Parliamo",

  // --- homepage hero (redesign) ----------------------------------------
  homeHeroTitle: "Pneumatici senza complicazioni.",
  homeHeroLede: "Prezzi competitivi. Ordini semplici. Consegne affidabili.",
  homeHeroBody:
    "GommaRush aiuta gommisti e officine a trovare e ordinare pneumatici senza perdere tempo fra pi\u00f9 fornitori. Assistenza rapida e tempi di consegna chiari, comunicati prima di ordinare.",
  heroImageAlt: "Furgoni GommaRush pronti per le consegne di pneumatici",
  heroStatusLabel: "Ordine confermato",
  heroStatusValue: "Consegna prevista: 48 ore",

  // --- value strip -------------------------------------------------------
  valueStripTitle: "In sintesi",
  value48Title: "48 ore",
  value48Body: "Consegna rapida",
  value7Title: "7 giorni",
  value7Body: "Pi\u00f9 possibilit\u00e0",
  valuePriceTitle: "Prezzi B2B",
  valuePriceBody: "Competitivi",
  valueSupportTitle: "Supporto",
  valueSupportBody: "Rapido e umano",

  // --- ordering simplicity ----------------------------------------------
  simpleEyebrow: "Semplice",
  simpleTitle: "Ordinare pneumatici dovrebbe essere semplice.",
  simpleLede:
    "Meno telefonate per capire chi ha cosa, meno tempo davanti a listini diversi. Il tempo che recuperi lo dedichi ai tuoi clienti.",
  step1Label: "Trova",
  step1Body: "Cerchi la misura che ti serve.",
  step2Label: "Scegli",
  step2Body: "Vedi prezzo e disponibilit\u00e0.",
  step3Label: "Ordina",
  step3Body: "Confermi in pochi passaggi.",
  step4Label: "Ricevi",
  step4Body: "Consegna affidabile alla tua attivit\u00e0.",

  // --- conceptual product visual ----------------------------------------
  mockupSizeLabel: "Misura",
  mockupResultsLabel: "Disponibilit\u00e0",
  mockupOrderCta: "Ordina",
  // Short forms for the compact chips. "gg" is giorni and must not survive
  // into English, which is exactly what happened when these were hardcoded.
  mockupWindow48: "48h",
  mockupWindow7: "7 gg",
  mockupDisclaimer:
    "Esempio illustrativo. Prezzi e disponibilit\u00e0 effettivi sono visibili dopo la registrazione.",

  // --- sourcing proposition ---------------------------------------------
  sourcingEyebrow: "Disponibilit\u00e0",
  sourcingTitle: "Pi\u00f9 possibilit\u00e0. Meno ricerche.",
  sourcingBody:
    "Lavoriamo con pi\u00f9 fonti di fornitura, cos\u00ec non devi controllarle una per una. Tu chiedi una misura: a cercarla ci pensiamo noi.",
  sourcingFlowSuppliers: "Pi\u00f9 fornitori",
  sourcingFlowUs: "GommaRush",
  sourcingFlowYou: "La tua attivit\u00e0",
  sourcingNote:
    "Non promettiamo di avere sempre il prezzo pi\u00f9 basso del mercato: promettiamo di dirti subito e con chiarezza che cosa possiamo darti e quando.",

  // --- delivery certainty ------------------------------------------------
  deliveryEyebrow: "Consegne",
  deliveryTitle: "Sai quanto costa. Sai quando arriva.",
  deliveryBody:
    "Il tempo di consegna \u00e8 indicato sull\u2019offerta, prima di confermare l\u2019ordine. Senza stime vaghe e senza richiamare per sapere dove sono i tuoi pneumatici.",
  delivery48Title: "48 ore",
  delivery48Body: "Consegna rapida sulle misure pi\u00f9 richieste.",
  delivery7Title: "7 giorni",
  delivery7Body: "Pi\u00f9 possibilit\u00e0 di scelta, con una data chiara.",
  deliveryFlowSupply: "Fornitura",
  deliveryFlowDepot: "Deposito GommaRush",
  deliveryFlowShop: "Gommista",

  // --- human support -----------------------------------------------------
  supportEyebrow: "Assistenza",
  supportTitle: "Tecnologia quando vuoi velocit\u00e0. Persone quando hai bisogno di aiuto.",
  supportBody:
    "Per un ordine di routine non serve parlare con nessuno. Quando invece qualcosa non torna, risponde una persona che conosce il tuo lavoro e la tua zona.",
  supportPointMessage: "Scrivici e ti rispondiamo.",
  supportPointPhone: "Al telefono, quando serve davvero.",
  supportPointPerson: "Sempre la stessa squadra, non un call center.",

  // --- why pillars -------------------------------------------------------
  pillarsEyebrow: "Perch\u00e9 GommaRush",
  pillarsTitle: "Un solo partner. Pi\u00f9 disponibilit\u00e0.",
  pillarSimpleTitle: "Ordini semplici",
  pillarSimpleBody: "Trovi, scegli e confermi senza passaggi inutili.",
  pillarPriceTitle: "Prezzi competitivi",
  pillarPriceBody: "Condizioni pensate per chi lavora nel settore.",
  pillarAvailabilityTitle: "Pi\u00f9 disponibilit\u00e0",
  pillarAvailabilityBody: "Pi\u00f9 fonti di fornitura, una sola richiesta.",
  pillarDeliveryTitle: "Consegne chiare",
  pillarDeliveryBody: "48 ore o 7 giorni, detto prima di ordinare.",
  pillarSupportTitle: "Supporto rapido",
  pillarSupportBody: "Persone raggiungibili quando serve.",
  pillarPartnerTitle: "Partner affidabile",
  pillarPartnerBody: "Logistica nostra, dal deposito alla tua porta.",

  // --- final conversion --------------------------------------------------
  finalTitle: "Meno tempo a cercare pneumatici.",
  finalTitleSecond: "Pi\u00f9 tempo per i tuoi clienti.",
  finalBody:
    "Registrati per vedere prezzi e disponibilit\u00e0 dedicati alla tua attivit\u00e0.",

  // --- registration (interim) -------------------------------------------
  registerPageTitle: "Registrazione in arrivo",
  registerPageLede:
    "Stiamo completando l\u2019area riservata ai clienti professionali. Nel frattempo puoi richiedere un\u2019offerta: ti rispondiamo con prezzi e tempi di consegna.",
  registerPageQuoteHint: "Il modo pi\u00f9 rapido per iniziare oggi",

  // --- come funziona page ------------------------------------------------
  howPageTitle: "Come funziona",
  howPageLede:
    "Dalla registrazione alla consegna, senza passaggi che ti fanno perdere tempo.",
  howStepRegisterLabel: "Registrati",
  howStepRegisterBody: "Apri l\u2019account della tua attivit\u00e0.",
  howClosing: "Il risultato: meno lavoro nella tua giornata.",

  // --- perche page -------------------------------------------------------
  whyPageTitle: "Perch\u00e9 GommaRush",
  whyPageLede:
    "Non siamo il distributore pi\u00f9 grande d\u2019Italia. Siamo quello con cui \u00e8 pi\u00f9 semplice lavorare.",
  whyPageOrderingTitle: "Ordinare senza attriti",
  whyPageOrderingBody:
    "Una misura, una richiesta, una risposta. Niente giri di telefonate per scoprire chi ha quel pneumatico in magazzino.",
  whyPagePriceTitle: "Prezzi da professionista",
  whyPagePriceBody:
    "Condizioni B2B costruite sul lavoro reale di un gommista, con margini che restano sostenibili per entrambi.",
  whyPageSourcingTitle: "Pi\u00f9 fonti, una sola richiesta",
  whyPageSourcingBody:
    "Controlliamo noi le disponibilit\u00e0. Se una misura non c\u2019\u00e8 da una parte, la cerchiamo dall\u2019altra.",
  whyPageDeliveryTitle: "Tempi dichiarati, non stimati",
  whyPageDeliveryBody:
    "48 ore o 7 giorni, indicato sull\u2019offerta. Sai quando pianificare l\u2019appuntamento con il tuo cliente.",
  whyPageSupportTitle: "Persone, non ticket",
  whyPageSupportBody:
    "Quando chiami risponde chi conosce la tua zona e i tuoi ordini precedenti.",
  whyPageLogisticsTitle: "Logistica nostra",
  whyPageLogisticsBody:
    "Deposito e mezzi sono nostri: l\u2019ultimo chilometro non lo subappaltiamo a nessuno.",

  // --- supplier page -----------------------------------------------------
  supPageTitle: "Hai pneumatici da consegnare?",
  supPageLede: "Pensiamo noi all\u2019ultimo miglio.",
  supPageBody:
    "Ritiriamo dal tuo deposito o riceviamo la merce nel nostro, smistiamo e consegniamo al tuo cliente finale. Tu mantieni il rapporto commerciale, noi ci occupiamo del trasporto.",
  supFlowSupplier: "Fornitore",
  supFlowUs: "GommaRush",
  supFlowCustomer: "Cliente finale",
  supPointHandlingTitle: "Merce trattata con cura",
  supPointHandlingBody: "Carico, smistamento e consegna gestiti da personale nostro.",
  supPointDepotTitle: "Deposito e smistamento",
  supPointDepotBody: "Riceviamo, controlliamo le quantit\u00e0 e prepariamo il giro.",
  supPointLastMileTitle: "Ultimo miglio affidabile",
  supPointLastMileBody: "Consegne tracciate, con prova di consegna al destinatario.",

  // --- footer ------------------------------------------------------------
  footerTagline: "Il modo pi\u00f9 semplice per acquistare pneumatici.",
  footerNavTitle: "Navigazione",
  footerCompanyTitle: "Azienda",
  footerAccessTitle: "Accessi",
  footerRights: "Tutti i diritti riservati.",
  // --- page metadata (browser tab + search results) ----------------------
  // Localised because the <title> is part of "changes everywhere": switching
  // to English used to leave the tab reading Italian.
  metaHomeTitle: "GommaRush | Pneumatici per gommisti e officine",
  metaHomeDesc:
    "Il modo pi\u00f9 semplice per acquistare pneumatici. Prezzi B2B per gommisti e officine, pi\u00f9 disponibilit\u00e0 da un solo partner e consegne in 48 ore o entro 7 giorni.",
  metaTyresTitle: "Pneumatici",
  metaTyresDesc:
    "Cerca lo pneumatico che ti serve e ordinalo da un solo partner. Prezzi B2B per gommisti e officine, con consegna in 48 ore o entro 7 giorni.",
  metaHowTitle: "Come funziona",
  metaHowDesc:
    "Registrati, trova la misura, scegli prezzo e disponibilit\u00e0, ordina e ricevi. Acquistare pneumatici per la tua attivit\u00e0 in pochi passaggi.",
  metaWhyTitle: "Perch\u00e9 GommaRush",
  metaWhyDesc:
    "Ordini semplici, prezzi competitivi, pi\u00f9 disponibilit\u00e0 e tempi di consegna dichiarati prima di ordinare. Il partner con cui \u00e8 pi\u00f9 semplice lavorare.",
  metaSuppliersTitle: "Per fornitori",
  metaSuppliersDesc:
    "Hai pneumatici da consegnare? Ritiriamo dal tuo deposito o riceviamo nel nostro, smistiamo e consegniamo al tuo cliente finale.",
  metaRegisterTitle: "Registrati",
  metaRegisterDesc:
    "Stiamo completando l\u2019area riservata ai clienti professionali. Nel frattempo puoi richiedere un\u2019offerta con prezzi e tempi di consegna.",
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

  finderCta: "Find your tyre",
  finderTitle: "Find your tyre",
  finderIntro: "Enter the barcode (EAN) or the manufacturer code printed on the tyre.",
  finderLabel: "Tyre code",
  finderPlaceholder: "e.g. 4717622044652",
  finderSubmit: "Search",
  finderSearching: "Searching…",
  finderNewSearch: "Search another code",
  finderClose: "Close",
  finderResultsOne: "1 tyre found",
  finderResultsMany: "{count} tyres found",
  finderEmptyTitle: "No tyre found",
  finderEmptyBody:
    "This code is not in our catalogue. Check the digits, or request an offer and we will take it from there.",
  finderInvalidTitle: "Invalid code",
  finderInvalidBody:
    "Those digits do not form a valid barcode. Please check the code on the tyre.",
  finderErrorTitle: "Search failed",
  finderErrorBody: "Please try again in a moment.",
  finderRateLimited: "Too many searches in a short time. Wait a few minutes and try again.",
  finderMatchedOnEan: "Matched by barcode",
  finderMatchedOnManufacturer: "Matched by manufacturer code",
  finderSpecSize: "Size",
  finderSpecLoadSpeed: "Load / speed rating",
  finderSpecSeason: "Season",
  finderSpecClass: "Category",
  finderSpecWeight: "Weight",
  finderSpecEprel: "EPREL code",
  finderSpecXl: "Reinforced (XL)",
  finderSpecRunFlat: "Run-flat",
  finderYes: "Yes",
  finderNo: "No",
  finderUnknownWeight: "Not stated",
  finderSeasonSummer: "Summer",
  finderSeasonWinter: "Winter",
  finderSeasonAllSeason: "All season",
  finderClassPassengerCar: "Passenger car",
  finderClassPassengerCarRunflat: "Passenger car run-flat",
  finderClassSuv4x4: "SUV / 4x4",
  finderClassLightTruckVan: "Van / light commercial",
  finderClassMotorcycle: "Motorcycle",
  finderClassScooter: "Scooter",
  finderClassOldDot: "Older DOT",
  finderClassSpare: "Spare wheel",

  brandsTitle: "The brands we supply",
  brandsAriaLabel: "Tyre brands supplied",

  whyTitle: "Why GommaRush?",
  whyReliableTitle: "A partner you can rely on",
  whyReliableBody: "We answer quickly and we keep to what we agree.",
  whyFastTitle: "Tyres when you need them",
  whyFastBody: "Delivery within 48 hours or 7 days — your choice.",
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
  within48h: "48 hours",
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

  // --- nav / CTA (redesign) ---------------------------------------------
  navTyres: "Tyres",
  navHowItWorks: "How it works",
  navWhy: "Why GommaRush",
  navSuppliers: "For suppliers",
  navClientArea: "Customer account",
  ctaRegister: "Sign up",
  ctaRegisterFree: "Sign up for free",
  ctaDiscoverHow: "See how it works",
  ctaTalk: "Let\u2019s talk",

  // --- homepage hero (redesign) ----------------------------------------
  homeHeroTitle: "Tyres, without the hassle.",
  homeHeroLede: "Competitive prices. Simple ordering. Dependable delivery.",
  homeHeroBody:
    "GommaRush helps tyre shops and garages find and order tyres without working through several suppliers. Responsive support, and delivery times made clear before you order.",
  heroImageAlt: "GommaRush vans ready for tyre deliveries",
  heroStatusLabel: "Order confirmed",
  heroStatusValue: "Expected delivery: 48 hours",

  // --- value strip -------------------------------------------------------
  valueStripTitle: "At a glance",
  value48Title: "48 hours",
  value48Body: "Fast delivery",
  value7Title: "7 days",
  value7Body: "More choice",
  valuePriceTitle: "Trade prices",
  valuePriceBody: "Competitive",
  valueSupportTitle: "Support",
  valueSupportBody: "Quick and human",

  // --- ordering simplicity ----------------------------------------------
  simpleEyebrow: "Simple",
  simpleTitle: "Ordering tyres should be simple.",
  simpleLede:
    "Fewer calls to work out who has what, less time across different price lists. The time you get back goes to your customers.",
  step1Label: "Find",
  step1Body: "Search the size you need.",
  step2Label: "Choose",
  step2Body: "See price and availability.",
  step3Label: "Order",
  step3Body: "Confirm in a few steps.",
  step4Label: "Receive",
  step4Body: "Dependable delivery to your business.",

  // --- conceptual product visual ----------------------------------------
  mockupSizeLabel: "Size",
  mockupResultsLabel: "Availability",
  mockupOrderCta: "Order",
  mockupWindow48: "48h",
  mockupWindow7: "7 d",
  mockupDisclaimer:
    "Illustrative example. Actual prices and availability are visible after you sign up.",

  // --- sourcing proposition ---------------------------------------------
  sourcingEyebrow: "Availability",
  sourcingTitle: "More options. Less searching.",
  sourcingBody:
    "We work with several supply sources, so you do not have to check them one by one. You ask for a size; finding it is our job.",
  sourcingFlowSuppliers: "Several suppliers",
  sourcingFlowUs: "GommaRush",
  sourcingFlowYou: "Your business",
  sourcingNote:
    "We do not claim to always have the lowest price on the market. We do promise to tell you clearly and quickly what we can supply, and when.",

  // --- delivery certainty ------------------------------------------------
  deliveryEyebrow: "Delivery",
  deliveryTitle: "You know the price. You know when it arrives.",
  deliveryBody:
    "The delivery time is shown on the offer, before you confirm the order. No vague estimates, and no calling back to find out where your tyres are.",
  delivery48Title: "48 hours",
  delivery48Body: "Fast delivery on the most requested sizes.",
  delivery7Title: "7 days",
  delivery7Body: "More choice, with a clear date.",
  deliveryFlowSupply: "Supply",
  deliveryFlowDepot: "GommaRush depot",
  deliveryFlowShop: "Tyre shop",

  // --- human support -----------------------------------------------------
  supportEyebrow: "Support",
  supportTitle: "Technology when you want speed. People when you need help.",
  supportBody:
    "A routine order needs no conversation at all. When something does not add up, you reach a person who understands your trade and your area.",
  supportPointMessage: "Message us and we reply.",
  supportPointPhone: "On the phone when it genuinely matters.",
  supportPointPerson: "The same team every time, not a call centre.",

  // --- why pillars -------------------------------------------------------
  pillarsEyebrow: "Why GommaRush",
  pillarsTitle: "One partner. More availability.",
  pillarSimpleTitle: "Simple ordering",
  pillarSimpleBody: "Find, choose and confirm with no wasted steps.",
  pillarPriceTitle: "Competitive prices",
  pillarPriceBody: "Terms built for people working in the trade.",
  pillarAvailabilityTitle: "More availability",
  pillarAvailabilityBody: "Several supply sources, one request.",
  pillarDeliveryTitle: "Clear delivery",
  pillarDeliveryBody: "48 hours or 7 days, told to you before you order.",
  pillarSupportTitle: "Quick support",
  pillarSupportBody: "People you can reach when you need them.",
  pillarPartnerTitle: "Dependable partner",
  pillarPartnerBody: "Our own logistics, from the depot to your door.",

  // --- final conversion --------------------------------------------------
  finalTitle: "Less time sourcing tyres.",
  finalTitleSecond: "More time for your customers.",
  finalBody: "Sign up to see prices and availability for your business.",

  // --- registration (interim) -------------------------------------------
  registerPageTitle: "Sign-up opening soon",
  registerPageLede:
    "We are finishing the account area for trade customers. In the meantime you can request a quote and we will come back with prices and delivery times.",
  registerPageQuoteHint: "The quickest way to get started today",

  // --- come funziona page ------------------------------------------------
  howPageTitle: "How it works",
  howPageLede: "From sign-up to delivery, without the steps that waste your time.",
  howStepRegisterLabel: "Sign up",
  howStepRegisterBody: "Open your business account.",
  howClosing: "The result: less work in your day.",

  // --- perche page -------------------------------------------------------
  whyPageTitle: "Why GommaRush",
  whyPageLede:
    "We are not Italy\u2019s largest distributor. We are the one that is simplest to work with.",
  whyPageOrderingTitle: "Ordering without friction",
  whyPageOrderingBody:
    "One size, one request, one answer. No round of phone calls to discover who has that tyre in stock.",
  whyPagePriceTitle: "Trade pricing",
  whyPagePriceBody:
    "B2B terms built around how a tyre shop actually works, with margins that stay sustainable on both sides.",
  whyPageSourcingTitle: "Several sources, one request",
  whyPageSourcingBody:
    "We check availability for you. If a size is not there from one source, we look to another.",
  whyPageDeliveryTitle: "Stated times, not estimates",
  whyPageDeliveryBody:
    "48 hours or 7 days, shown on the offer. So you know when to book your customer in.",
  whyPageSupportTitle: "People, not tickets",
  whyPageSupportBody:
    "When you call, you reach someone who knows your area and your previous orders.",
  whyPageLogisticsTitle: "Our own logistics",
  whyPageLogisticsBody:
    "The depot and the vans are ours: we do not subcontract the last mile to anyone.",

  // --- supplier page -----------------------------------------------------
  supPageTitle: "Got tyres to deliver?",
  supPageLede: "We will handle the last mile.",
  supPageBody:
    "We collect from your depot or receive the goods at ours, sort them and deliver to your end customer. You keep the commercial relationship; we handle the transport.",
  supFlowSupplier: "Supplier",
  supFlowUs: "GommaRush",
  supFlowCustomer: "End customer",
  supPointHandlingTitle: "Goods handled with care",
  supPointHandlingBody: "Loading, sorting and delivery by our own staff.",
  supPointDepotTitle: "Depot and sorting",
  supPointDepotBody: "We receive, check the quantities and prepare the round.",
  supPointLastMileTitle: "Reliable last mile",
  supPointLastMileBody: "Tracked deliveries, with proof of delivery to the recipient.",

  // --- footer ------------------------------------------------------------
  footerTagline: "The simplest way to buy tyres.",
  footerNavTitle: "Navigation",
  footerCompanyTitle: "Company",
  footerAccessTitle: "Access",
  footerRights: "All rights reserved.",
  // --- page metadata (browser tab + search results) ----------------------
  metaHomeTitle: "GommaRush | Tyres for tyre shops and garages",
  metaHomeDesc:
    "The simplest way to buy tyres. Trade pricing for tyre shops and garages, more availability from one partner, and delivery in 48 hours or within 7 days.",
  metaTyresTitle: "Tyres",
  metaTyresDesc:
    "Search the tyre you need and order it from a single partner. Trade pricing for tyre shops and garages, with delivery in 48 hours or within 7 days.",
  metaHowTitle: "How it works",
  metaHowDesc:
    "Sign up, find the size, choose price and availability, order and receive. Buying tyres for your business in a few steps.",
  metaWhyTitle: "Why GommaRush",
  metaWhyDesc:
    "Simple ordering, competitive prices, more availability, and delivery times stated before you order. The partner that is simplest to work with.",
  metaSuppliersTitle: "For suppliers",
  metaSuppliersDesc:
    "Got tyres to deliver? We collect from your depot or receive them at ours, sort them and deliver to your end customer.",
  metaRegisterTitle: "Sign up",
  metaRegisterDesc:
    "We are finishing the account area for trade customers. In the meantime you can request a quote with prices and delivery times.",
};

const DICTIONARIES: Record<Locale, SiteCopy> = { it, en };

export function getCopy(locale: Locale): SiteCopy {
  return DICTIONARIES[locale] ?? DICTIONARIES.it;
}
