// Central translation + status-label map for the operational UI.
//
// Italian throughout, matching the public site. Code and database
// identifiers stay in English; only what an operator reads is translated.
// Every user-facing string in the admin/driver screens resolves through
// this file, so a second locale would be one more entry in `DICTIONARIES`
// and no component changes.

import type {
  IncidentType,
  InventoryUnitStatus,
  ItemType,
  OrderStatus,
  ScanType,
} from "@/lib/types/logistics";

export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "it";

/** Semantic colour bucket for a status, so components don't hardcode palettes. */
export type StatusTone = "neutral" | "waiting" | "progress" | "success" | "warning" | "danger";

interface StatusMeta {
  label: string;
  tone: StatusTone;
}

interface Dictionary {
  orderStatus: Record<OrderStatus, StatusMeta>;
  unitStatus: Record<InventoryUnitStatus, StatusMeta>;
  itemType: Record<ItemType, string>;
  scanType: Record<ScanType, string>;
  incidentType: Record<IncidentType, string>;
  /** Flat UI strings. Keyed so a missing translation is a type error. */
  ui: Record<UiKey, string>;
  /** Operational error codes returned by server routes / RPCs. */
  errors: Record<string, string>;
}

export type UiKey =
  | "appName"
  | "admin"
  | "adminLogin"
  | "driverLogin"
  | "email"
  | "password"
  | "signIn"
  | "signOut"
  | "dashboard"
  | "ordersInProgress"
  | "ordersOnHold"
  | "customerList"
  | "addOrder"
  | "whereToAdd"
  | "todaysDeliveries"
  | "tomorrowsDeliveries"
  | "uploadDocument"
  | "manualEntry"
  | "comingSoon"
  | "orderNumber"
  | "customer"
  | "itemCount"
  | "driverVehicle"
  | "status"
  | "plannedDate"
  | "actions"
  | "edit"
  | "delete"
  | "cancelOrder"
  | "moveToHold"
  | "reactivate"
  | "inspect"
  | "save"
  | "cancel"
  | "confirm"
  | "back"
  | "supplier"
  | "deliveryLocation"
  | "payment"
  | "assignment"
  | "products"
  | "addLine"
  | "removeLine"
  | "driver"
  | "vehicle"
  | "quantity"
  | "description"
  | "brand"
  | "model"
  | "type"
  | "price"
  | "startScanning"
  | "stopScanning"
  | "orderFound"
  | "noConfidentMatch"
  | "manualSearch"
  | "search"
  | "wrongItem"
  | "wrongItemDetail"
  | "alreadyStored"
  | "storageScan"
  | "loadingScan"
  | "addManuallyAsLoaded"
  | "reason"
  | "reasonRequired"
  | "readOnlyView"
  | "totals"
  | "received"
  | "stored"
  | "loaded"
  | "analysisNotConfigured"
  | "reviewBeforeSave"
  | "matchConfirmed"
  | "possibleMatch"
  | "newCustomer"
  | "newLocation"
  | "useAddressForThisOrderOnly"
  | "addAsNewLocation"
  | "updateExistingLocation"
  | "unassigned"
  | "retry"
  | "noOrders"
  | "loading"
  | "selectDriverSession"
  | "changeSession"
  | "expectedUnits"
  | "loadingProgress"
  | "lastKnown"
  | "companyName"
  | "vatNumber"
  | "contacts"
  | "city"
  | "province"
  | "postalCode"
  | "address"
  | "deliveryNotes"
  | "locations"
  | "addLocation"
  | "documentReference"
  | "amountToCollect"
  | "collectionMethod"
  | "requiresPaymentOnDelivery"
  | "print";

const it: Dictionary = {
  orderStatus: {
    draft: { label: "Bozza", tone: "neutral" },
    review_required: { label: "Da verificare", tone: "warning" },
    confirmed: { label: "Confermato", tone: "waiting" },
    expected: { label: "In attesa di arrivo in magazzino", tone: "waiting" },
    partially_received: { label: "Ricevuto parzialmente", tone: "progress" },
    received: { label: "Ricevuto", tone: "progress" },
    sorting: { label: "In smistamento", tone: "progress" },
    stored: { label: "In magazzino", tone: "progress" },
    ready_for_loading: { label: "Pronto per il carico", tone: "progress" },
    partially_loaded: { label: "Caricato parzialmente", tone: "progress" },
    loaded: { label: "Caricato", tone: "success" },
    out_for_delivery: { label: "In consegna", tone: "success" },
    partially_delivered: { label: "Consegnato parzialmente", tone: "progress" },
    delivered: { label: "Consegnato", tone: "success" },
    returned: { label: "Reso", tone: "warning" },
    on_hold: { label: "In attesa", tone: "warning" },
    cancelled: { label: "Annullato", tone: "danger" },
  },
  unitStatus: {
    expected: { label: "Atteso", tone: "waiting" },
    ready_for_loading: { label: "Pronto per il carico", tone: "progress" },
    received: { label: "Ricevuto", tone: "progress" },
    stored: { label: "In magazzino", tone: "progress" },
    loaded: { label: "Caricato", tone: "success" },
    out_for_delivery: { label: "In consegna", tone: "success" },
    delivered: { label: "Consegnato", tone: "success" },
    returned: { label: "Reso", tone: "warning" },
    defective: { label: "Difettoso", tone: "danger" },
    damaged: { label: "Danneggiato", tone: "danger" },
    missing: { label: "Mancante (da cercare)", tone: "warning" },
    lost: { label: "Perso (confermato)", tone: "danger" },
    quarantine: { label: "Quarantena", tone: "warning" },
    disposed: { label: "Dismesso", tone: "neutral" },
  },
  itemType: {
    tyre: "Pneumatico",
    tube: "Camera d'aria",
    wheel: "Cerchio / ruota",
    accessory: "Accessorio",
    other: "Altro",
    service: "Servizio",
    fee: "Spesa",
  },
  scanType: {
    received: "Scansione etichetta fornitore",
    manual_check: "Abbinamento manuale",
    storage: "Scansione stoccaggio",
    loading: "Scansione carico",
    manual_loading: "Carico manuale (eccezione)",
    inventory_check: "Verifica / audit",
    zone_scan: "Scansione zona",
    unloading: "Scarico",
    delivery: "Consegna",
    return: "Reso",
    found: "Oggetto ritrovato",
  },
  incidentType: {
    return: "Reso",
    defect: "Difettoso",
    damage: "Danneggiamento",
    // Deliberately distinct: 'missing' is still being looked for,
    // 'lost' is a confirmed loss after investigation.
    missing: "Mancante (da cercare)",
    lost: "Perso (confermato)",
    wrong_item: "Prodotto errato",
    wrong_delivery: "Consegna errata",
    customer_refusal: "Rifiuto del cliente",
    warranty: "Garanzia",
    quarantine: "Quarantena",
    disposed: "Dismesso",
    other: "Altro",
  },
  ui: {
    appName: "GommaRush Logistica",
    admin: "Admin",
    adminLogin: "Accesso amministratore",
    driverLogin: "Accesso autista",
    email: "Email",
    password: "Password",
    signIn: "Accedi",
    signOut: "Esci",
    dashboard: "Pannello di controllo",
    ordersInProgress: "Ordini in corso",
    ordersOnHold: "In attesa",
    customerList: "Elenco clienti",
    addOrder: "Aggiungi ordine",
    whereToAdd: "Dove vuoi aggiungere l'ordine?",
    todaysDeliveries: "Consegne di oggi",
    tomorrowsDeliveries: "Consegne di domani",
    uploadDocument: "Carica documento",
    manualEntry: "Inserimento manuale",
    comingSoon: "Prossimamente",
    orderNumber: "N. ordine",
    customer: "Cliente",
    itemCount: "N. articoli",
    driverVehicle: "Autista / Veicolo",
    status: "Stato",
    plannedDate: "Data prevista",
    actions: "Azioni",
    edit: "Modifica",
    delete: "Elimina",
    cancelOrder: "Annulla ordine",
    moveToHold: "Metti in attesa",
    reactivate: "Riattiva",
    inspect: "Vedi dettagli",
    save: "Salva",
    cancel: "Annulla",
    confirm: "Conferma",
    back: "Indietro",
    supplier: "Fornitore",
    deliveryLocation: "Luogo di consegna",
    payment: "Pagamento",
    assignment: "Assegnazione",
    products: "Prodotti",
    addLine: "Aggiungi riga",
    removeLine: "Elimina riga",
    driver: "Autista",
    vehicle: "Veicolo",
    quantity: "Quantità",
    description: "Descrizione",
    brand: "Marca",
    model: "Model",
    type: "Tipo",
    price: "Prezzo",
    startScanning: "Avvia scansione",
    stopScanning: "Ferma scansione",
    orderFound: "ORDINE TROVATO",
    noConfidentMatch: "Nessuna corrispondenza certa",
    manualSearch: "Inserimento manuale",
    search: "Cerca",
    wrongItem: "ARTICOLO ERRATO",
    wrongItemDetail: "Questo prodotto appartiene a un'altra consegna",
    alreadyStored: "Articolo già registrato in magazzino",
    storageScan: "Scansione stoccaggio",
    loadingScan: "Scansione carico",
    addManuallyAsLoaded: "Aggiungi manualmente come caricato",
    reason: "Motivo",
    reasonRequired: "Il motivo è obbligatorio",
    readOnlyView: "Visualizzazione (sola lettura)",
    totals: "Totale",
    received: "ricevuti",
    stored: "in magazzino",
    loaded: "caricati",
    analysisNotConfigured: "L'analisi automatica non è configurata",
    reviewBeforeSave: "Controlla i dati prima di salvare",
    matchConfirmed: "Cliente identificato",
    possibleMatch: "Possibile cliente trovato — verifica l'indirizzo",
    newCustomer: "Nuovo cliente",
    newLocation: "Nuovo indirizzo",
    useAddressForThisOrderOnly: "Usa l'indirizzo solo per questo ordine",
    addAsNewLocation: "Aggiungi come nuovo indirizzo del cliente",
    updateExistingLocation: "Aggiorna un indirizzo esistente",
    unassigned: "Non assegnato",
    retry: "Riprova",
    noOrders: "Nessun ordine",
    loading: "Caricamento…",
    selectDriverSession: "Scegli autista e veicolo",
    changeSession: "Cambia",
    expectedUnits: "Articoli attesi",
    loadingProgress: "Avanzamento carico",
    lastKnown: "ULTIMA POSIZIONE",
    companyName: "Ragione sociale",
    vatNumber: "Codice fiscale / P.IVA",
    contacts: "Contatti",
    city: "Città",
    province: "Provincia",
    postalCode: "CAP",
    address: "Indirizzo",
    deliveryNotes: "Note di consegna",
    locations: "Luoghi di consegna",
    addLocation: "Aggiungi indirizzo",
    documentReference: "Riferimento documento",
    amountToCollect: "Importo da incassare",
    collectionMethod: "Metodo di incasso",
    requiresPaymentOnDelivery: "Richiede pagamento alla consegna",
    print: "Stampa",
  },
  errors: {
    ORDER_NOT_FOUND: "Ordine non trovato",
    ORDER_ITEM_NOT_FOUND: "Riga prodotto non trovata",
    ORDER_NOT_ACTIVE: "L'ordine non è attivo",
    ORDER_CANCELLED: "L'ordine è stato annullato",
    UNIT_NOT_FOUND: "Articolo scansionato non trovato",
    NO_UNIT_EXPECTED: "Tutti gli articoli di questa riga sono già stati ricevuti",
    LABEL_UNREADABLE: "Etichetta illeggibile",
    POSSIBLE_CUSTOMER_MATCH: "Possibile cliente trovato — verifica l'indirizzo",
    ALREADY_SCANNED: "Questo prodotto è già stato scansionato",
    ALREADY_STORED: "Articolo già registrato in magazzino",
    ALREADY_LOADED: "Articolo già registrato come caricato",
    ALREADY_MOVED_ON: "L'articolo è già avanzato nel flusso",
    ALREADY_PROCESSED: "La scansione è già stata registrata",
    NOT_STORED: "L'articolo non è ancora in magazzino — scansionalo prima allo stoccaggio",
    WRONG_DRIVER: "Il prodotto appartiene a un altro veicolo",
    WRONG_VEHICLE: "Il prodotto appartiene a un altro veicolo",
    NOT_READY: "L'ordine non è pronto per il carico",
    NO_VEHICLE: "Assegna prima un veicolo all'ordine",
    NOT_LOADED: "L'ordine non è ancora stato caricato",
    ALREADY_DELIVERED: "L'ordine è già stato consegnato",
    ALREADY_LOADED_ORDER: "L'ordine è già stato segnato come caricato",
    STATUS_NOT_ALLOWED: "Questo stato non può essere impostato manualmente",
    REASON_REQUIRED: "Il motivo è obbligatorio",
    ANALYSIS_NOT_CONFIGURED: "L'analisi automatica non è configurata",
    ANALYSIS_FAILED: "Il documento non è stato analizzato automaticamente",
    UNSUPPORTED_FILE_TYPE: "Tipo di file non supportato",
    FILE_TOO_LARGE: "Il file è troppo grande",
    UPLOAD_FAILED: "Caricamento del documento non riuscito",
    UNAUTHORIZED: "Sessione scaduta — accedi di nuovo",
    INVALID_CREDENTIALS: "Email o password errate",
    FORBIDDEN: "Questo account non ha accesso al pannello di amministrazione",
    NOT_A_DRIVER: "Questo account non è associato a nessun autista — contatta l'amministratore",
    DRIVER_NOT_FOUND: "Autista non trovato",
    VEHICLE_NOT_FOUND: "Veicolo non trovato",
    SUPABASE_NOT_CONFIGURED: "Il servizio di autenticazione non è momentaneamente disponibile",
    RATE_LIMITED: "Troppi tentativi — attendi e riprova",
    ADMIN_SESSION_SECRET_MISSING:
      "Configurazione server incompleta (ADMIN_SESSION_SECRET mancante) — contatta l'amministratore",
    VALIDATION_FAILED: "Dati incompleti o non validi",
    SAVE_FAILED: "Salvataggio non riuscito",
    NO_DRIVER_SESSION: "Scegli prima autista e veicolo",
    CAMERA_UNAVAILABLE: "La fotocamera non è disponibile su questo dispositivo",
    CAMERA_DENIED: "Accesso alla fotocamera negato",
    UNKNOWN: "Si è verificato un errore imprevisto",
  },
};


const en: Dictionary = {
  orderStatus: {
    draft: { label: "Draft", tone: "neutral" },
    review_required: { label: "Needs review", tone: "warning" },
    confirmed: { label: "Confirmed", tone: "waiting" },
    expected: { label: "Awaiting arrival at warehouse", tone: "waiting" },
    partially_received: { label: "Partially received", tone: "progress" },
    received: { label: "Received", tone: "progress" },
    sorting: { label: "Sorting", tone: "progress" },
    stored: { label: "In warehouse", tone: "progress" },
    ready_for_loading: { label: "Ready for loading", tone: "progress" },
    partially_loaded: { label: "Partially loaded", tone: "progress" },
    loaded: { label: "Loaded", tone: "success" },
    out_for_delivery: { label: "Out for delivery", tone: "success" },
    partially_delivered: { label: "Partially delivered", tone: "progress" },
    delivered: { label: "Delivered", tone: "success" },
    returned: { label: "Returned", tone: "warning" },
    on_hold: { label: "On hold", tone: "warning" },
    cancelled: { label: "Cancelled", tone: "danger" },
  },
  unitStatus: {
    expected: { label: "Expected", tone: "waiting" },
    ready_for_loading: { label: "Ready for loading", tone: "progress" },
    received: { label: "Received", tone: "progress" },
    stored: { label: "In warehouse", tone: "progress" },
    loaded: { label: "Loaded", tone: "success" },
    out_for_delivery: { label: "Out for delivery", tone: "success" },
    delivered: { label: "Delivered", tone: "success" },
    returned: { label: "Returned", tone: "warning" },
    defective: { label: "Defective", tone: "danger" },
    damaged: { label: "Damaged", tone: "danger" },
    missing: { label: "Missing (searching)", tone: "warning" },
    lost: { label: "Lost (confirmed)", tone: "danger" },
    quarantine: { label: "Quarantine", tone: "warning" },
    disposed: { label: "Disposed", tone: "neutral" },
  },
  itemType: {
    tyre: "Tyre",
    tube: "Inner tube",
    wheel: "Rim / wheel",
    accessory: "Accessory",
    other: "Other",
    service: "Service",
    fee: "Fee",
  },
  scanType: {
    received: "Supplier label scan",
    manual_check: "Manual match",
    storage: "Storage scan",
    loading: "Loading scan",
    manual_loading: "Manual loading (exception)",
    inventory_check: "Check / audit",
    zone_scan: "Zone scan",
    unloading: "Unloading",
    delivery: "Delivery",
    return: "Returned",
    found: "Item found",
  },
  incidentType: {
    return: "Returned",
    defect: "Defective",
    damage: "Damage",
    // Deliberately distinct: 'missing' is still being looked for,
    // 'lost' is a confirmed loss after investigation.
    missing: "Missing (searching)",
    lost: "Lost (confirmed)",
    wrong_item: "Wrong item",
    wrong_delivery: "Wrong delivery",
    customer_refusal: "Customer refusal",
    warranty: "Warranty",
    quarantine: "Quarantine",
    disposed: "Disposed",
    other: "Other",
  },
  ui: {
    appName: "GommaRush Logistics",
    admin: "Admin",
    adminLogin: "Admin sign-in",
    driverLogin: "Driver sign-in",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signOut: "Sign out",
    dashboard: "Dashboard",
    ordersInProgress: "Orders in progress",
    ordersOnHold: "On hold",
    customerList: "Customer list",
    addOrder: "Add order",
    whereToAdd: "Where do you want to add the order?",
    todaysDeliveries: "Today's deliveries",
    tomorrowsDeliveries: "Tomorrow's deliveries",
    uploadDocument: "Upload document",
    manualEntry: "Manual entry",
    comingSoon: "Coming soon",
    orderNumber: "Order no.",
    customer: "Customer",
    itemCount: "Item count",
    driverVehicle: "Driver / Vehicle",
    status: "Status",
    plannedDate: "Planned date",
    actions: "Actions",
    edit: "Edit",
    delete: "Delete",
    cancelOrder: "Cancel order",
    moveToHold: "Put on hold",
    reactivate: "Reactivate",
    inspect: "View details",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    back: "Back",
    supplier: "Supplier",
    deliveryLocation: "Delivery location",
    payment: "Payment",
    assignment: "Assignment",
    products: "Products",
    addLine: "Add line",
    removeLine: "Remove line",
    driver: "Driver",
    vehicle: "Vehicle",
    quantity: "Quantity",
    description: "Description",
    brand: "Brand",
    model: "Model",
    type: "Type",
    price: "Price",
    startScanning: "Start scanning",
    stopScanning: "Stop scanning",
    orderFound: "ORDER FOUND",
    noConfidentMatch: "No confident match",
    manualSearch: "Manual entry",
    search: "Search",
    wrongItem: "WRONG ITEM",
    wrongItemDetail: "This product belongs to another delivery",
    alreadyStored: "Item already recorded as stored",
    storageScan: "Storage scan",
    loadingScan: "Loading scan",
    addManuallyAsLoaded: "Add manually as loaded",
    reason: "Reason",
    reasonRequired: "A reason is required",
    readOnlyView: "View only",
    totals: "Total",
    received: "received",
    stored: "stored",
    loaded: "loaded",
    analysisNotConfigured: "Automatic analysis is not configured",
    reviewBeforeSave: "Check the data before saving",
    matchConfirmed: "Customer identified",
    possibleMatch: "Possible customer found — check the address",
    newCustomer: "New customer",
    newLocation: "New location",
    useAddressForThisOrderOnly: "Use this address for this order only",
    addAsNewLocation: "Add as a new customer location",
    updateExistingLocation: "Update an existing location",
    unassigned: "Unassigned",
    retry: "Retry",
    noOrders: "No orders",
    loading: "Loading…",
    selectDriverSession: "Choose driver and vehicle",
    changeSession: "Change",
    expectedUnits: "Expected items",
    loadingProgress: "Loading progress",
    lastKnown: "LAST KNOWN",
    companyName: "Company name",
    vatNumber: "Tax code / VAT no.",
    contacts: "Contacts",
    city: "City",
    province: "Province",
    postalCode: "Postcode",
    address: "Address",
    deliveryNotes: "Delivery notes",
    locations: "Delivery locations",
    addLocation: "Add location",
    documentReference: "Document reference",
    amountToCollect: "Amount to collect",
    collectionMethod: "Collection method",
    requiresPaymentOnDelivery: "Requires payment on delivery",
    print: "Print",
  },
  errors: {
    ORDER_NOT_FOUND: "Order not found",
    ORDER_ITEM_NOT_FOUND: "Order line not found",
    ORDER_NOT_ACTIVE: "The order is not active",
    ORDER_CANCELLED: "The order was cancelled",
    UNIT_NOT_FOUND: "Scanned item not found",
    NO_UNIT_EXPECTED: "Every item on this line has already been received",
    LABEL_UNREADABLE: "The label could not be read",
    POSSIBLE_CUSTOMER_MATCH: "Possible customer found — check the address",
    ALREADY_SCANNED: "This product has already been scanned",
    ALREADY_STORED: "Item already recorded as stored",
    ALREADY_LOADED: "Item already recorded as loaded",
    ALREADY_MOVED_ON: "The item has already moved further along",
    ALREADY_PROCESSED: "The scan has already been recorded",
    NOT_STORED: "The item is not in the warehouse yet — scan it at storage first",
    WRONG_DRIVER: "The product belongs to another vehicle",
    WRONG_VEHICLE: "The product belongs to another vehicle",
    NOT_READY: "The order is not ready for loading",
    NO_VEHICLE: "Assign a vehicle to the order first",
    NOT_LOADED: "The order has not been loaded yet",
    ALREADY_DELIVERED: "The order has already been delivered",
    ALREADY_LOADED_ORDER: "The order is already marked as loaded",
    STATUS_NOT_ALLOWED: "This status cannot be set manually",
    REASON_REQUIRED: "A reason is required",
    ANALYSIS_NOT_CONFIGURED: "Automatic analysis is not configured",
    ANALYSIS_FAILED: "The document could not be analysed automatically",
    UNSUPPORTED_FILE_TYPE: "Unsupported file type",
    FILE_TOO_LARGE: "The file is too large",
    UPLOAD_FAILED: "Document upload failed",
    UNAUTHORIZED: "Session expired — sign in again",
    INVALID_CREDENTIALS: "Wrong email or password",
    FORBIDDEN: "This account has no access to the admin panel",
    NOT_A_DRIVER: "This account is not linked to any driver — contact the administrator",
    DRIVER_NOT_FOUND: "Driver not found",
    VEHICLE_NOT_FOUND: "Vehicle not found",
    SUPABASE_NOT_CONFIGURED: "The authentication service is temporarily unavailable",
    RATE_LIMITED: "Too many attempts — wait and try again",
    ADMIN_SESSION_SECRET_MISSING:
      "Incomplete server configuration (ADMIN_SESSION_SECRET missing) — contact the administrator",
    VALIDATION_FAILED: "Incomplete or invalid data",
    SAVE_FAILED: "Saving failed",
    NO_DRIVER_SESSION: "Choose a driver and vehicle first",
    CAMERA_UNAVAILABLE: "The camera is not available on this device",
    CAMERA_DENIED: "Camera access denied",
    UNKNOWN: "An unexpected error occurred",
  },
};

const DICTIONARIES: Record<Locale, Dictionary> = { it, en };

function dict(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? it;
}

export function t(key: UiKey, locale: Locale = DEFAULT_LOCALE): string {
  return dict(locale).ui[key];
}

export function orderStatusMeta(status: string, locale: Locale = DEFAULT_LOCALE): StatusMeta {
  const table = dict(locale).orderStatus as Record<string, StatusMeta | undefined>;
  // Unknown statuses (e.g. a value added by a later migration) degrade to the
  // raw identifier rather than crashing the dashboard.
  return table[status] ?? { label: status, tone: "neutral" };
}

export function unitStatusMeta(status: string, locale: Locale = DEFAULT_LOCALE): StatusMeta {
  const table = dict(locale).unitStatus as Record<string, StatusMeta | undefined>;
  return table[status] ?? { label: status, tone: "neutral" };
}

export function itemTypeLabel(type: string, locale: Locale = DEFAULT_LOCALE): string {
  const table = dict(locale).itemType as Record<string, string | undefined>;
  return table[type] ?? type;
}

export function scanTypeLabel(type: string, locale: Locale = DEFAULT_LOCALE): string {
  const table = dict(locale).scanType as Record<string, string | undefined>;
  return table[type] ?? type;
}

export function incidentTypeLabel(type: string, locale: Locale = DEFAULT_LOCALE): string {
  const table = dict(locale).incidentType as Record<string, string | undefined>;
  return table[type] ?? type;
}

/**
 * Human-readable message for an operational error code. Unknown codes fall
 * back to a generic message rather than leaking an internal identifier into
 * the warehouse UI — but they are never silently swallowed: callers log the
 * raw code server-side.
 */
export function errorMessage(code: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!code) return dict(locale).errors.UNKNOWN;
  return dict(locale).errors[code] ?? dict(locale).errors.UNKNOWN;
}
