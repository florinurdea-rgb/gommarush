/**
 * Inter-Sprint feed fixtures.
 *
 * Four rows copied verbatim from the `vrd-pcr` sample workbook Antonello Moio
 * (Inter-Sprint) sent on 5 August 2026 as a sample of the files their
 * integration places on our FTP folder. Whitespace inside `itemcode` and the
 * two spaces inside '>  20' are reproduced exactly, because both are part of
 * the contract these tests pin.
 *
 * Four rather than 9,559 on purpose: enough to cover the shapes that matter,
 * without committing a supplier's live price list to the repository.
 *
 * Chosen for what each one proves:
 *   nankang145R10        banded availability, no EPREL, real weight
 *   vredestein20555R16   exact availability, the 205/55 R16 the preview uses,
 *                        a non-zero `gross`, 'XL' present only in prose
 *   bridgestone28535R20  weight of literally '0', which is not a weight
 *   doubleCoinTruck      the truck file's 22.5" rim written as '225'
 */

export type IntersprintFeedRow = Record<string, string>;

export const INTERSPRINT_PCR_ROWS = {
  nankang145R10: {
    sysnr: "12851",
    itemcode: "145    R 10TTR10",
    description: "145     R10 TL 84N  NANK TR10",
    Type: "TR10",
    brand: "NA",
    "brand description": "NANKANG",
    group: "16",
    "group description": "BESTELWAGEN BANDEN",
    "E-mark": "J",
    European: "N",
    "width tyre": "145",
    "aspect ratio": "80",
    diameter: "10",
    "LI/SI": "84N",
    "nett-price": "66.08",
    gross: "0",
    available: ">  20",
    eancode: "4717622044652",
    "ip-code": "EB208",
    photolink: "https://www.etyre.net/preview/t3/na-tr10.jpg",
    weight: "6.0309999999999997",
    "Fuel effeciency": "",
    "Wet grip": "",
    Rollnoise: "",
    Noiselevel: "",
    Snowgrip: "",
    Icegrip: "",
    "EPREL-id": "",
    "EPREL-url": "",
    wcat: "1",
  } satisfies IntersprintFeedRow,

  vredestein20555R16: {
    sysnr: "34197",
    itemcode: "205 55VR 16TWINTRACXL",
    description: "205/55 VR16 TL 94V  VR WINTRAC XL",
    Type: "WINTRACXL",
    brand: "VR",
    "brand description": "VREDESTEIN",
    group: "13",
    "group description": "LUXE BANDEN M&S",
    "E-mark": "J",
    European: "J",
    "width tyre": "205",
    "aspect ratio": "55",
    diameter: "16",
    "LI/SI": "94V",
    "nett-price": "99.2",
    gross: "143",
    available: "6",
    eancode: "8714692361425",
    "ip-code": "AP20555016VWTRA02",
    photolink: "https://www.etyre.net/preview/t3/vr-wintrac.jpg",
    weight: "8.2379999999999995",
    "Fuel effeciency": "C",
    "Wet grip": "B",
    Rollnoise: "70",
    Noiselevel: "B",
    Snowgrip: "J",
    Icegrip: "N",
    "EPREL-id": "615687",
    "EPREL-url": "https://eprel.ec.europa.eu/qr/615687",
    wcat: "1",
  } satisfies IntersprintFeedRow,

  bridgestone28535R20: {
    sysnr: "538231",
    itemcode: "285 35ZR 20TPSPORTXLAO",
    description: "285/35 ZR20 TL 104Y BR POTENZA SPORT XL AO",
    Type: "PSPORTXLAO",
    brand: "BR",
    "brand description": "BRIDGESTONE",
    group: "11",
    "group description": "LUXE BANDEN",
    "E-mark": "",
    European: "",
    "width tyre": "285",
    "aspect ratio": "35",
    diameter: "20",
    "LI/SI": "104Y",
    "nett-price": "222.93",
    gross: "0",
    available: ">  20",
    eancode: "3286342842318",
    "ip-code": "28423",
    photolink: "",
    weight: "0",
    "Fuel effeciency": "B",
    "Wet grip": "A",
    Rollnoise: "72",
    Noiselevel: "A",
    Snowgrip: "N",
    Icegrip: "N",
    "EPREL-id": "2207855",
    "EPREL-url": "https://eprel.ec.europa.eu/qr/2207855",
    wcat: "2",
  } satisfies IntersprintFeedRow,
};

/** One row from the `vrd-truck` sample. Note the rim: 22.5" written as '225'. */
export const INTERSPRINT_TRUCK_ROW: IntersprintFeedRow = {
  sysnr: "26725",
  itemcode: "255 70 R225TRT500",
  description: "255/70  R225TL 140N DC RT500 (ST)",
  Type: "RT500",
  brand: "DC",
  "brand description": "DOUBLE COIN",
  group: "41",
  "group description": "TRUCKBANDEN",
  "E-mark": "J",
  European: "N",
  "width tyre": "255",
  "aspect ratio": "70",
  diameter: "225",
  "LI/SI": "140N",
  "nett-price": "151.9",
  gross: "281",
  available: ">  20",
  eancode: "8859513010011",
  "ip-code": "80201175",
  photolink: "https://www.etyre.net/preview/t3/dc-rt500.jpg",
  weight: "",
  "Fuel effeciency": "",
  "Wet grip": "",
  Rollnoise: "",
  Noiselevel: "",
  Snowgrip: "",
  Icegrip: "",
  "EPREL-id": "",
  "EPREL-url": "",
};

/**
 * A row from past the end of the data.
 *
 * The samples are saved to Excel's full 1,048,576-row grid; 1,039,016 PCR rows
 * look exactly like this. The stray '20' sits in the `nett-price` column, so a
 * reader that trusted the column would find a million EUR 20 tyres.
 */
export const INTERSPRINT_PADDING_ROW: IntersprintFeedRow = {
  "nett-price": "20",
};

/** A fixture row with specific cells overridden. */
export function intersprintRow(
  base: IntersprintFeedRow,
  overrides: Record<string, string>
): IntersprintFeedRow {
  return { ...base, ...overrides };
}
