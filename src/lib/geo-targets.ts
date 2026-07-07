// Map Google Ads geo target constant ID (country level) → tên nước.
// Quy tắc: ID country của Google = 2000 + mã số ISO 3166-1 (vd 2840 = 2000+840 = Mỹ).
// Ta chỉ lưu country_criterion_id (từ geographic_view) nên chỉ cần bảng nước.
// Đổi ISO-numeric → alpha-2 rồi để Intl.DisplayNames ra tên (ưu tiên tiếng Việt).

// ISO 3166-1 numeric → alpha-2 (danh sách chuẩn). Thiếu/không khớp → trả null (hiện ID gốc).
const NUMERIC_TO_ALPHA2: Record<number, string> = {
  4: 'AF', 8: 'AL', 12: 'DZ', 20: 'AD', 24: 'AO', 28: 'AG', 32: 'AR', 51: 'AM', 36: 'AU', 40: 'AT',
  31: 'AZ', 44: 'BS', 48: 'BH', 50: 'BD', 52: 'BB', 112: 'BY', 56: 'BE', 84: 'BZ', 204: 'BJ', 64: 'BT',
  68: 'BO', 70: 'BA', 72: 'BW', 76: 'BR', 96: 'BN', 100: 'BG', 854: 'BF', 108: 'BI', 132: 'CV', 116: 'KH',
  120: 'CM', 124: 'CA', 140: 'CF', 148: 'TD', 152: 'CL', 156: 'CN', 170: 'CO', 174: 'KM', 178: 'CG', 180: 'CD',
  188: 'CR', 384: 'CI', 191: 'HR', 192: 'CU', 196: 'CY', 203: 'CZ', 208: 'DK', 262: 'DJ', 212: 'DM', 214: 'DO',
  218: 'EC', 818: 'EG', 222: 'SV', 226: 'GQ', 232: 'ER', 233: 'EE', 748: 'SZ', 231: 'ET', 242: 'FJ', 246: 'FI',
  250: 'FR', 266: 'GA', 270: 'GM', 268: 'GE', 276: 'DE', 288: 'GH', 300: 'GR', 308: 'GD', 320: 'GT', 324: 'GN',
  624: 'GW', 328: 'GY', 332: 'HT', 340: 'HN', 344: 'HK', 348: 'HU', 352: 'IS', 356: 'IN', 360: 'ID', 364: 'IR',
  368: 'IQ', 372: 'IE', 376: 'IL', 380: 'IT', 388: 'JM', 392: 'JP', 400: 'JO', 398: 'KZ', 404: 'KE', 296: 'KI',
  408: 'KP', 410: 'KR', 414: 'KW', 417: 'KG', 418: 'LA', 428: 'LV', 422: 'LB', 426: 'LS', 430: 'LR', 434: 'LY',
  438: 'LI', 440: 'LT', 442: 'LU', 446: 'MO', 450: 'MG', 454: 'MW', 458: 'MY', 462: 'MV', 466: 'ML', 470: 'MT',
  584: 'MH', 478: 'MR', 480: 'MU', 484: 'MX', 583: 'FM', 498: 'MD', 492: 'MC', 496: 'MN', 499: 'ME', 504: 'MA',
  508: 'MZ', 104: 'MM', 516: 'NA', 520: 'NR', 524: 'NP', 528: 'NL', 554: 'NZ', 558: 'NI', 562: 'NE', 566: 'NG',
  807: 'MK', 578: 'NO', 512: 'OM', 586: 'PK', 585: 'PW', 275: 'PS', 591: 'PA', 598: 'PG', 600: 'PY', 604: 'PE',
  608: 'PH', 616: 'PL', 620: 'PT', 634: 'QA', 642: 'RO', 643: 'RU', 646: 'RW', 659: 'KN', 662: 'LC', 670: 'VC',
  882: 'WS', 674: 'SM', 678: 'ST', 682: 'SA', 686: 'SN', 688: 'RS', 690: 'SC', 694: 'SL', 702: 'SG', 703: 'SK',
  705: 'SI', 90: 'SB', 706: 'SO', 710: 'ZA', 728: 'SS', 724: 'ES', 144: 'LK', 729: 'SD', 740: 'SR', 752: 'SE',
  756: 'CH', 760: 'SY', 158: 'TW', 762: 'TJ', 834: 'TZ', 764: 'TH', 626: 'TL', 768: 'TG', 776: 'TO', 780: 'TT',
  788: 'TN', 792: 'TR', 795: 'TM', 798: 'TV', 800: 'UG', 804: 'UA', 784: 'AE', 826: 'GB', 840: 'US', 858: 'UY',
  860: 'UZ', 548: 'VU', 862: 'VE', 704: 'VN', 887: 'YE', 894: 'ZM', 716: 'ZW',
}

let viNames: Intl.DisplayNames | null = null
let enNames: Intl.DisplayNames | null = null
function displayNames(): { vi: Intl.DisplayNames | null; en: Intl.DisplayNames | null } {
  if (typeof Intl === 'undefined' || !('DisplayNames' in Intl)) return { vi: null, en: null }
  try {
    viNames = viNames ?? new Intl.DisplayNames(['vi'], { type: 'region' })
    enNames = enNames ?? new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return { vi: null, en: null }
  }
  return { vi: viNames, en: enNames }
}

// Trả tên nước cho một Google geo ID (dạng string). Không nhận diện được → null.
export function countryNameByGeoId(geoId: string): string | null {
  const n = Number(geoId)
  if (!Number.isFinite(n) || n <= 2000 || n >= 3000) return null
  const alpha2 = NUMERIC_TO_ALPHA2[n - 2000]
  if (!alpha2) return null
  const { vi, en } = displayNames()
  try {
    return vi?.of(alpha2) ?? en?.of(alpha2) ?? alpha2
  } catch {
    return alpha2
  }
}
