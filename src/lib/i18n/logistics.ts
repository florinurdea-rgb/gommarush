// Central translation + status-label map for the operational UI.
//
// Romanian is the operational language for Phase 1. Code and database
// identifiers stay in English; only what a warehouse operator reads is
// translated. Every user-facing string in the admin/driver/warehouse screens
// resolves through this file so a second locale (Italian) can be added by
// adding one more entry to `DICTIONARIES` — no component changes.

import type {
  IncidentType,
  InventoryUnitStatus,
  ItemType,
  OrderStatus,
  PrintJobStatus,
  ScanType,
} from "@/lib/types/logistics";

export const LOCALES = ["ro", "it"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ro";

/** Semantic colour bucket for a status, so components don't hardcode palettes. */
export type StatusTone = "neutral" | "waiting" | "progress" | "success" | "warning" | "danger";

interface StatusMeta {
  label: string;
  tone: StatusTone;
}

interface Dictionary {
  orderStatus: Record<OrderStatus, StatusMeta>;
  unitStatus: Record<InventoryUnitStatus, StatusMeta>;
  printJobStatus: Record<PrintJobStatus, StatusMeta>;
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
  | "stand"
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
  | "standFree"
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
  | "standUnavailable"
  | "unassigned"
  | "printQueue"
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
  | "standQrCodes"
  | "print";

const ro: Dictionary = {
  orderStatus: {
    draft: { label: "Ciornă", tone: "neutral" },
    review_required: { label: "Necesită verificare", tone: "warning" },
    confirmed: { label: "Confirmat", tone: "waiting" },
    expected: { label: "Se așteaptă livrare la depozit", tone: "waiting" },
    partially_received: { label: "Recepționat parțial", tone: "progress" },
    received: { label: "Recepționat", tone: "progress" },
    sorting: { label: "În sortare", tone: "progress" },
    stored: { label: "Depozitat", tone: "progress" },
    ready_for_loading: { label: "Pregătit pentru încărcare", tone: "progress" },
    partially_loaded: { label: "Încărcat parțial", tone: "progress" },
    loaded: { label: "Încărcat", tone: "success" },
    out_for_delivery: { label: "În curs de livrare", tone: "success" },
    partially_delivered: { label: "Livrat parțial", tone: "progress" },
    delivered: { label: "Livrat", tone: "success" },
    returned: { label: "Returnat", tone: "warning" },
    on_hold: { label: "În așteptare", tone: "warning" },
    cancelled: { label: "Anulat", tone: "danger" },
  },
  unitStatus: {
    expected: { label: "Se așteaptă", tone: "waiting" },
    ready_for_loading: { label: "Pregătit pentru încărcare", tone: "progress" },
    received: { label: "Recepționat", tone: "progress" },
    stored: { label: "Depozitat", tone: "progress" },
    loaded: { label: "Încărcat", tone: "success" },
    out_for_delivery: { label: "În curs de livrare", tone: "success" },
    delivered: { label: "Livrat", tone: "success" },
    returned: { label: "Returnat", tone: "warning" },
    defective: { label: "Defect", tone: "danger" },
    damaged: { label: "Deteriorat", tone: "danger" },
    missing: { label: "Lipsă (de căutat)", tone: "warning" },
    lost: { label: "Pierdut (confirmat)", tone: "danger" },
    quarantine: { label: "Carantină", tone: "warning" },
    disposed: { label: "Casat", tone: "neutral" },
  },
  printJobStatus: {
    pending: { label: "În coadă", tone: "waiting" },
    processing: { label: "Se printează", tone: "progress" },
    printed: { label: "Printat", tone: "success" },
    failed: { label: "Eșuat", tone: "danger" },
    cancelled: { label: "Anulat", tone: "neutral" },
  },
  itemType: {
    tyre: "Anvelopă",
    tube: "Cameră aer",
    wheel: "Jantă / roată",
    accessory: "Accesoriu",
    other: "Altele",
    service: "Serviciu",
    fee: "Taxă",
  },
  scanType: {
    received: "Scanare etichetă furnizor",
    manual_check: "Asociere manuală",
    storage: "Scanare depozitare",
    loading: "Scanare încărcare",
    manual_loading: "Încărcare manuală (excepție)",
    inventory_check: "Verificare / audit",
    zone_scan: "Scanare zonă",
    unloading: "Descărcare",
    delivery: "Livrare",
    return: "Retur",
    found: "Obiect găsit",
  },
  incidentType: {
    return: "Retur",
    defect: "Defect",
    damage: "Deteriorare",
    // Deliberately distinct: 'missing' is still being looked for,
    // 'lost' is a confirmed loss after investigation.
    missing: "Lipsă (de căutat)",
    lost: "Pierdut (confirmat)",
    wrong_item: "Produs greșit",
    wrong_delivery: "Livrare greșită",
    customer_refusal: "Refuz client",
    warranty: "Garanție",
    quarantine: "Carantină",
    disposed: "Casat",
    other: "Altele",
  },
  ui: {
    appName: "GoRush Logistică",
    admin: "Admin",
    adminLogin: "Autentificare Admin",
    email: "Email",
    password: "Parolă",
    signIn: "Intră în cont",
    signOut: "Ieși",
    dashboard: "Panou de control",
    ordersInProgress: "Comenzi în curs",
    ordersOnHold: "În așteptare",
    customerList: "Listă clienți",
    addOrder: "Adaugă comandă",
    whereToAdd: "Unde adaugi comanda?",
    todaysDeliveries: "Livrările de azi",
    tomorrowsDeliveries: "Livrările de mâine",
    uploadDocument: "Încarcă document",
    manualEntry: "Introducere manuală",
    comingSoon: "În curând",
    orderNumber: "Nr. comandă",
    stand: "Stativ",
    customer: "Client",
    itemCount: "Nr. obiecte",
    driverVehicle: "Șofer / Mașină",
    status: "Status",
    plannedDate: "Data planificată",
    actions: "Acțiuni",
    edit: "Editează",
    delete: "Șterge",
    cancelOrder: "Anulează comanda",
    moveToHold: "Mută în așteptare",
    reactivate: "Reactivează",
    inspect: "Vezi detalii",
    save: "Salvează",
    cancel: "Renunță",
    confirm: "Confirmă",
    back: "Înapoi",
    supplier: "Furnizor",
    deliveryLocation: "Locație de livrare",
    payment: "Plată",
    assignment: "Alocare",
    products: "Produse",
    addLine: "Adaugă linie",
    removeLine: "Șterge linia",
    driver: "Șofer",
    vehicle: "Mașină",
    quantity: "Cantitate",
    description: "Descriere",
    brand: "Marcă",
    model: "Model",
    type: "Tip",
    price: "Preț",
    startScanning: "Începe scanarea",
    stopScanning: "Oprește scanarea",
    orderFound: "COMANDĂ GĂSITĂ",
    noConfidentMatch: "Nu am găsit o asociere sigură",
    manualSearch: "Introducere manuală",
    search: "Caută",
    wrongItem: "OBIECT GREȘIT",
    wrongItemDetail: "Acest produs aparține altei livrări",
    alreadyStored: "Obiect deja înregistrat ca depozitat",
    storageScan: "Scanare depozitare",
    loadingScan: "Scanare încărcare",
    addManuallyAsLoaded: "Adaugă manual ca încărcat",
    reason: "Motiv",
    reasonRequired: "Motivul este obligatoriu",
    standFree: "liber",
    readOnlyView: "Vizualizare (doar citire)",
    totals: "Total",
    received: "recepționate",
    stored: "depozitate",
    loaded: "încărcate",
    analysisNotConfigured: "Analiza automată nu este configurată",
    reviewBeforeSave: "Verifică datele înainte de salvare",
    matchConfirmed: "Client identificat",
    possibleMatch: "Client posibil găsit — verifică adresa",
    newCustomer: "Client nou",
    newLocation: "Locație nouă",
    useAddressForThisOrderOnly: "Folosește adresa doar pentru această comandă",
    addAsNewLocation: "Adaugă ca locație nouă a clientului",
    updateExistingLocation: "Actualizează o locație existentă",
    standUnavailable: "Stativ indisponibil",
    unassigned: "Nealocat",
    printQueue: "Coadă de printare",
    retry: "Reîncearcă",
    noOrders: "Nicio comandă",
    loading: "Se încarcă…",
    selectDriverSession: "Alege șoferul și mașina",
    changeSession: "Schimbă",
    expectedUnits: "Obiecte așteptate",
    loadingProgress: "Progres încărcare",
    lastKnown: "ULTIMA LOCAȚIE",
    companyName: "Denumire firmă",
    vatNumber: "Cod fiscal / P.IVA",
    contacts: "Contacte",
    city: "Oraș",
    province: "Provincie",
    postalCode: "Cod poștal",
    address: "Adresă",
    deliveryNotes: "Note livrare",
    locations: "Locații de livrare",
    addLocation: "Adaugă locație",
    documentReference: "Referință document",
    amountToCollect: "Sumă de încasat",
    collectionMethod: "Metodă de încasare",
    requiresPaymentOnDelivery: "Necesită plată la livrare",
    standQrCodes: "Coduri QR stative",
    print: "Printează",
  },
  errors: {
    ORDER_NOT_FOUND: "Nu am găsit comanda",
    ORDER_ITEM_NOT_FOUND: "Nu am găsit linia de produs",
    ORDER_NOT_ACTIVE: "Comanda nu este activă",
    ORDER_CANCELLED: "Comanda a fost anulată",
    UNIT_NOT_FOUND: "Nu am găsit obiectul scanat",
    NO_UNIT_EXPECTED: "Toate obiectele de pe această linie au fost deja recepționate",
    LABEL_UNREADABLE: "Eticheta nu a putut fi citită",
    POSSIBLE_CUSTOMER_MATCH: "Client posibil găsit — verifică adresa",
    STAND_OCCUPIED: "Stativ indisponibil",
    NO_STAND_AVAILABLE: "Niciun stativ liber — alocă manual",
    INVALID_STAND: "Stativ invalid",
    ALREADY_SCANNED: "Acest produs a fost deja scanat",
    ALREADY_STORED: "Obiect deja înregistrat ca depozitat",
    ALREADY_LOADED: "Obiect deja înregistrat ca încărcat",
    ALREADY_MOVED_ON: "Obiectul a trecut deja mai departe în flux",
    ALREADY_PROCESSED: "Scanarea a fost deja înregistrată",
    NOT_STORED: "Obiectul nu este încă depozitat — scanează-l mai întâi la depozitare",
    WRONG_DRIVER: "Produsul aparține altei mașini",
    WRONG_VEHICLE: "Produsul aparține altei mașini",
    PRINTER_UNAVAILABLE:
      "Imprimanta nu este disponibilă — eticheta rămâne în coada de printare",
    REASON_REQUIRED: "Motivul este obligatoriu",
    ANALYSIS_NOT_CONFIGURED: "Analiza automată nu este configurată",
    ANALYSIS_FAILED: "Documentul nu a putut fi analizat automat",
    UNSUPPORTED_FILE_TYPE: "Tip de fișier neacceptat",
    FILE_TOO_LARGE: "Fișierul este prea mare",
    UPLOAD_FAILED: "Încărcarea documentului a eșuat",
    UNAUTHORIZED: "Sesiune expirată — autentifică-te din nou",
    INVALID_CREDENTIALS: "Email sau parolă greșite",
    SUPABASE_NOT_CONFIGURED:
      "Configurare server incompletă (Supabase) — contactează administratorul",
    RATE_LIMITED: "Prea multe încercări — așteaptă câteva minute și reîncearcă",
    ADMIN_SESSION_SECRET_MISSING:
      "Configurare server incompletă (ADMIN_SESSION_SECRET lipsă) — contactează administratorul",
    VALIDATION_FAILED: "Date incomplete sau invalide",
    SAVE_FAILED: "Salvarea a eșuat",
    NO_DRIVER_SESSION: "Alege mai întâi șoferul și mașina",
    JOB_NOT_FOUND: "Nu am găsit sarcina de printare",
    ALREADY_PRINTED: "Eticheta a fost deja printată",
    CAMERA_UNAVAILABLE: "Camera nu este disponibilă pe acest dispozitiv",
    CAMERA_DENIED: "Accesul la cameră a fost refuzat",
    UNKNOWN: "A apărut o eroare neașteptată",
  },
};

// Italian is intentionally not translated yet — Phase 1 ships Romanian only.
// The structure is here so adding `it` is a data change, not a code change.
const DICTIONARIES: Record<Locale, Dictionary> = { ro, it: ro };

function dict(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? ro;
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

export function printJobStatusMeta(status: string, locale: Locale = DEFAULT_LOCALE): StatusMeta {
  const table = dict(locale).printJobStatus as Record<string, StatusMeta | undefined>;
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
