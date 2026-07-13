// Chuẩn hóa dimension từ network affiliate về giá trị chung:
// - country → ISO-3166 alpha-2 UPPER ('US', 'VN'...) — khớp map geo criterion của Google Ads
// - device  → 'mobile' | 'desktop' | 'tablet' | 'other'
// LƯU Ý: bảng dữ liệu này có bản mirror TypeScript ở src/lib/normalize-geo.ts (Next.js
// không import được từ engine/) — sửa bảng ở đây thì sửa cả bên đó.

// [alpha2, alpha3, ...tên/alias thường gặp (lowercase)]
const COUNTRIES = [
  ['AD', 'AND', 'andorra'],
  ['AE', 'ARE', 'united arab emirates', 'uae'],
  ['AF', 'AFG', 'afghanistan'],
  ['AG', 'ATG', 'antigua and barbuda'],
  ['AI', 'AIA', 'anguilla'],
  ['AL', 'ALB', 'albania'],
  ['AM', 'ARM', 'armenia'],
  ['AO', 'AGO', 'angola'],
  ['AQ', 'ATA', 'antarctica'],
  ['AR', 'ARG', 'argentina'],
  ['AS', 'ASM', 'american samoa'],
  ['AT', 'AUT', 'austria'],
  ['AU', 'AUS', 'australia'],
  ['AW', 'ABW', 'aruba'],
  ['AX', 'ALA', 'aland islands', 'åland islands'],
  ['AZ', 'AZE', 'azerbaijan'],
  ['BA', 'BIH', 'bosnia and herzegovina', 'bosnia'],
  ['BB', 'BRB', 'barbados'],
  ['BD', 'BGD', 'bangladesh'],
  ['BE', 'BEL', 'belgium'],
  ['BF', 'BFA', 'burkina faso'],
  ['BG', 'BGR', 'bulgaria'],
  ['BH', 'BHR', 'bahrain'],
  ['BI', 'BDI', 'burundi'],
  ['BJ', 'BEN', 'benin'],
  ['BL', 'BLM', 'saint barthelemy', 'saint barthélemy'],
  ['BM', 'BMU', 'bermuda'],
  ['BN', 'BRN', 'brunei', 'brunei darussalam'],
  ['BO', 'BOL', 'bolivia'],
  ['BQ', 'BES', 'caribbean netherlands', 'bonaire'],
  ['BR', 'BRA', 'brazil'],
  ['BS', 'BHS', 'bahamas'],
  ['BT', 'BTN', 'bhutan'],
  ['BV', 'BVT', 'bouvet island'],
  ['BW', 'BWA', 'botswana'],
  ['BY', 'BLR', 'belarus'],
  ['BZ', 'BLZ', 'belize'],
  ['CA', 'CAN', 'canada'],
  ['CC', 'CCK', 'cocos islands', 'cocos (keeling) islands'],
  ['CD', 'COD', 'democratic republic of the congo', 'dr congo', 'congo-kinshasa', 'congo, democratic republic'],
  ['CF', 'CAF', 'central african republic'],
  ['CG', 'COG', 'republic of the congo', 'congo', 'congo-brazzaville'],
  ['CH', 'CHE', 'switzerland'],
  ['CI', 'CIV', 'ivory coast', "cote d'ivoire", "côte d'ivoire"],
  ['CK', 'COK', 'cook islands'],
  ['CL', 'CHL', 'chile'],
  ['CM', 'CMR', 'cameroon'],
  ['CN', 'CHN', 'china'],
  ['CO', 'COL', 'colombia'],
  ['CR', 'CRI', 'costa rica'],
  ['CU', 'CUB', 'cuba'],
  ['CV', 'CPV', 'cabo verde', 'cape verde'],
  ['CW', 'CUW', 'curacao', 'curaçao'],
  ['CX', 'CXR', 'christmas island'],
  ['CY', 'CYP', 'cyprus'],
  ['CZ', 'CZE', 'czechia', 'czech republic'],
  ['DE', 'DEU', 'germany'],
  ['DJ', 'DJI', 'djibouti'],
  ['DK', 'DNK', 'denmark'],
  ['DM', 'DMA', 'dominica'],
  ['DO', 'DOM', 'dominican republic'],
  ['DZ', 'DZA', 'algeria'],
  ['EC', 'ECU', 'ecuador'],
  ['EE', 'EST', 'estonia'],
  ['EG', 'EGY', 'egypt'],
  ['EH', 'ESH', 'western sahara'],
  ['ER', 'ERI', 'eritrea'],
  ['ES', 'ESP', 'spain'],
  ['ET', 'ETH', 'ethiopia'],
  ['FI', 'FIN', 'finland'],
  ['FJ', 'FJI', 'fiji'],
  ['FK', 'FLK', 'falkland islands'],
  ['FM', 'FSM', 'micronesia'],
  ['FO', 'FRO', 'faroe islands'],
  ['FR', 'FRA', 'france'],
  ['GA', 'GAB', 'gabon'],
  ['GB', 'GBR', 'united kingdom', 'uk', 'great britain', 'england', 'britain'],
  ['GD', 'GRD', 'grenada'],
  ['GE', 'GEO', 'georgia'],
  ['GF', 'GUF', 'french guiana'],
  ['GG', 'GGY', 'guernsey'],
  ['GH', 'GHA', 'ghana'],
  ['GI', 'GIB', 'gibraltar'],
  ['GL', 'GRL', 'greenland'],
  ['GM', 'GMB', 'gambia'],
  ['GN', 'GIN', 'guinea'],
  ['GP', 'GLP', 'guadeloupe'],
  ['GQ', 'GNQ', 'equatorial guinea'],
  ['GR', 'GRC', 'greece'],
  ['GS', 'SGS', 'south georgia'],
  ['GT', 'GTM', 'guatemala'],
  ['GU', 'GUM', 'guam'],
  ['GW', 'GNB', 'guinea-bissau'],
  ['GY', 'GUY', 'guyana'],
  ['HK', 'HKG', 'hong kong'],
  ['HM', 'HMD', 'heard island'],
  ['HN', 'HND', 'honduras'],
  ['HR', 'HRV', 'croatia'],
  ['HT', 'HTI', 'haiti'],
  ['HU', 'HUN', 'hungary'],
  ['ID', 'IDN', 'indonesia'],
  ['IE', 'IRL', 'ireland'],
  ['IL', 'ISR', 'israel'],
  ['IM', 'IMN', 'isle of man'],
  ['IN', 'IND', 'india'],
  ['IO', 'IOT', 'british indian ocean territory'],
  ['IQ', 'IRQ', 'iraq'],
  ['IR', 'IRN', 'iran'],
  ['IS', 'ISL', 'iceland'],
  ['IT', 'ITA', 'italy'],
  ['JE', 'JEY', 'jersey'],
  ['JM', 'JAM', 'jamaica'],
  ['JO', 'JOR', 'jordan'],
  ['JP', 'JPN', 'japan'],
  ['KE', 'KEN', 'kenya'],
  ['KG', 'KGZ', 'kyrgyzstan'],
  ['KH', 'KHM', 'cambodia'],
  ['KI', 'KIR', 'kiribati'],
  ['KM', 'COM', 'comoros'],
  ['KN', 'KNA', 'saint kitts and nevis'],
  ['KP', 'PRK', 'north korea'],
  ['KR', 'KOR', 'south korea', 'korea', 'republic of korea', 'korea, republic of'],
  ['KW', 'KWT', 'kuwait'],
  ['KY', 'CYM', 'cayman islands'],
  ['KZ', 'KAZ', 'kazakhstan'],
  ['LA', 'LAO', 'laos', "lao people's democratic republic"],
  ['LB', 'LBN', 'lebanon'],
  ['LC', 'LCA', 'saint lucia'],
  ['LI', 'LIE', 'liechtenstein'],
  ['LK', 'LKA', 'sri lanka'],
  ['LR', 'LBR', 'liberia'],
  ['LS', 'LSO', 'lesotho'],
  ['LT', 'LTU', 'lithuania'],
  ['LU', 'LUX', 'luxembourg'],
  ['LV', 'LVA', 'latvia'],
  ['LY', 'LBY', 'libya'],
  ['MA', 'MAR', 'morocco'],
  ['MC', 'MCO', 'monaco'],
  ['MD', 'MDA', 'moldova'],
  ['ME', 'MNE', 'montenegro'],
  ['MF', 'MAF', 'saint martin'],
  ['MG', 'MDG', 'madagascar'],
  ['MH', 'MHL', 'marshall islands'],
  ['MK', 'MKD', 'north macedonia', 'macedonia'],
  ['ML', 'MLI', 'mali'],
  ['MM', 'MMR', 'myanmar', 'burma'],
  ['MN', 'MNG', 'mongolia'],
  ['MO', 'MAC', 'macao', 'macau'],
  ['MP', 'MNP', 'northern mariana islands'],
  ['MQ', 'MTQ', 'martinique'],
  ['MR', 'MRT', 'mauritania'],
  ['MS', 'MSR', 'montserrat'],
  ['MT', 'MLT', 'malta'],
  ['MU', 'MUS', 'mauritius'],
  ['MV', 'MDV', 'maldives'],
  ['MW', 'MWI', 'malawi'],
  ['MX', 'MEX', 'mexico'],
  ['MY', 'MYS', 'malaysia'],
  ['MZ', 'MOZ', 'mozambique'],
  ['NA', 'NAM', 'namibia'],
  ['NC', 'NCL', 'new caledonia'],
  ['NE', 'NER', 'niger'],
  ['NF', 'NFK', 'norfolk island'],
  ['NG', 'NGA', 'nigeria'],
  ['NI', 'NIC', 'nicaragua'],
  ['NL', 'NLD', 'netherlands', 'holland', 'the netherlands'],
  ['NO', 'NOR', 'norway'],
  ['NP', 'NPL', 'nepal'],
  ['NR', 'NRU', 'nauru'],
  ['NU', 'NIU', 'niue'],
  ['NZ', 'NZL', 'new zealand'],
  ['OM', 'OMN', 'oman'],
  ['PA', 'PAN', 'panama'],
  ['PE', 'PER', 'peru'],
  ['PF', 'PYF', 'french polynesia'],
  ['PG', 'PNG', 'papua new guinea'],
  ['PH', 'PHL', 'philippines'],
  ['PK', 'PAK', 'pakistan'],
  ['PL', 'POL', 'poland'],
  ['PM', 'SPM', 'saint pierre and miquelon'],
  ['PN', 'PCN', 'pitcairn'],
  ['PR', 'PRI', 'puerto rico'],
  ['PS', 'PSE', 'palestine', 'palestinian territories'],
  ['PT', 'PRT', 'portugal'],
  ['PW', 'PLW', 'palau'],
  ['PY', 'PRY', 'paraguay'],
  ['QA', 'QAT', 'qatar'],
  ['RE', 'REU', 'reunion', 'réunion'],
  ['RO', 'ROU', 'romania'],
  ['RS', 'SRB', 'serbia'],
  ['RU', 'RUS', 'russia', 'russian federation'],
  ['RW', 'RWA', 'rwanda'],
  ['SA', 'SAU', 'saudi arabia'],
  ['SB', 'SLB', 'solomon islands'],
  ['SC', 'SYC', 'seychelles'],
  ['SD', 'SDN', 'sudan'],
  ['SE', 'SWE', 'sweden'],
  ['SG', 'SGP', 'singapore'],
  ['SH', 'SHN', 'saint helena'],
  ['SI', 'SVN', 'slovenia'],
  ['SJ', 'SJM', 'svalbard and jan mayen', 'svalbard'],
  ['SK', 'SVK', 'slovakia'],
  ['SL', 'SLE', 'sierra leone'],
  ['SM', 'SMR', 'san marino'],
  ['SN', 'SEN', 'senegal'],
  ['SO', 'SOM', 'somalia'],
  ['SR', 'SUR', 'suriname'],
  ['SS', 'SSD', 'south sudan'],
  ['ST', 'STP', 'sao tome and principe', 'são tomé and príncipe'],
  ['SV', 'SLV', 'el salvador'],
  ['SX', 'SXM', 'sint maarten'],
  ['SY', 'SYR', 'syria', 'syrian arab republic'],
  ['SZ', 'SWZ', 'eswatini', 'swaziland'],
  ['TC', 'TCA', 'turks and caicos islands'],
  ['TD', 'TCD', 'chad'],
  ['TF', 'ATF', 'french southern territories'],
  ['TG', 'TGO', 'togo'],
  ['TH', 'THA', 'thailand'],
  ['TJ', 'TJK', 'tajikistan'],
  ['TK', 'TKL', 'tokelau'],
  ['TL', 'TLS', 'timor-leste', 'east timor'],
  ['TM', 'TKM', 'turkmenistan'],
  ['TN', 'TUN', 'tunisia'],
  ['TO', 'TON', 'tonga'],
  ['TR', 'TUR', 'turkey', 'turkiye', 'türkiye'],
  ['TT', 'TTO', 'trinidad and tobago'],
  ['TV', 'TUV', 'tuvalu'],
  ['TW', 'TWN', 'taiwan'],
  ['TZ', 'TZA', 'tanzania'],
  ['UA', 'UKR', 'ukraine'],
  ['UG', 'UGA', 'uganda'],
  ['UM', 'UMI', 'united states minor outlying islands'],
  ['US', 'USA', 'united states', 'united states of america', 'u.s.', 'u.s.a.', 'america', 'us of a', 'estados unidos'],
  ['UY', 'URY', 'uruguay'],
  ['UZ', 'UZB', 'uzbekistan'],
  ['VA', 'VAT', 'vatican', 'holy see', 'vatican city'],
  ['VC', 'VCT', 'saint vincent and the grenadines'],
  ['VE', 'VEN', 'venezuela'],
  ['VG', 'VGB', 'british virgin islands', 'virgin islands, british'],
  ['VI', 'VIR', 'us virgin islands', 'u.s. virgin islands', 'virgin islands, u.s.'],
  ['VN', 'VNM', 'vietnam', 'viet nam', 'việt nam'],
  ['VU', 'VUT', 'vanuatu'],
  ['WF', 'WLF', 'wallis and futuna'],
  ['WS', 'WSM', 'samoa'],
  ['XK', 'XKX', 'kosovo'], // không chính thức ISO nhưng network hay dùng
  ['YE', 'YEM', 'yemen'],
  ['YT', 'MYT', 'mayotte'],
  ['ZA', 'ZAF', 'south africa'],
  ['ZM', 'ZMB', 'zambia'],
  ['ZW', 'ZWE', 'zimbabwe'],
]

const ALPHA2 = new Set(COUNTRIES.map((c) => c[0]))
const ALPHA3_TO_2 = new Map(COUNTRIES.map((c) => [c[1], c[0]]))
const NAME_TO_2 = new Map()
for (const [a2, , ...names] of COUNTRIES) {
  for (const name of names) NAME_TO_2.set(name, a2)
}

// value network trả (code/tên bất kỳ) → alpha-2 UPPER, không nhận diện được → ''
// Thứ tự: value_map trong config (user override) → alpha-2 → alpha-3 → tên/alias tiếng Anh.
export function normalizeCountry(value, valueMap = null) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (valueMap && valueMap[lower] !== undefined) return String(valueMap[lower]).toUpperCase()
  const upper = raw.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper) && ALPHA2.has(upper)) return upper
  if (/^[A-Z]{3}$/.test(upper) && ALPHA3_TO_2.has(upper)) return ALPHA3_TO_2.get(upper)
  return NAME_TO_2.get(lower) ?? ''
}

// value network trả → 'mobile' | 'desktop' | 'tablet' | 'other' ('' nếu rỗng)
export function normalizeDevice(value, valueMap = null) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (valueMap && valueMap[lower] !== undefined) return String(valueMap[lower]).toLowerCase()
  if (/(tab|ipad)/.test(lower)) return 'tablet' // trước mobile: 'tablet' chứa chữ khác, iPad chạy iOS
  if (/(mob|phone|android|ios|iphone|smartphone)/.test(lower)) return 'mobile'
  if (/(desk|pc|computer|windows|mac|linux|laptop)/.test(lower)) return 'desktop'
  return 'other'
}

// ── Trích dimension từ CỘT TEXT HỖN HỢP (vd Localrent "Warsaw, Poland desktop, ENG") ──
// Nhiều network nhét quốc gia+thành phố+thiết bị chung 1 cột → không có cột sạch để normalize.
// Quét TÊN NƯỚC (≥4 ký tự, ưu tiên dài, word-boundary) / TỪ KHÓA THIẾT BỊ nhúng bất kỳ đâu.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Chỉ tên ≥4 ký tự (loại alias 2-3 ký tự như 'uk','usa' dễ khớp nhầm trong text). Ưu tiên tên dài.
const EXTRACT_ENTRIES = [...NAME_TO_2.entries()].filter(([n]) => n.length >= 4).sort((a, b) => b[0].length - a[0].length)
const COUNTRY_TEXT_RE = new RegExp('\\b(' + EXTRACT_ENTRIES.map(([n]) => escapeRe(n)).join('|') + ')\\b', 'i')

// text (chuỗi hỗn hợp) → alpha-2 UPPER. Thử normalizeCountry (giá trị sạch) trước; rồi quét tên nước.
export function extractCountryFromText(value, valueMap = null) {
  const clean = normalizeCountry(value, valueMap)
  if (clean) return clean
  if (value === null || value === undefined) return ''
  const m = String(value).toLowerCase().match(COUNTRY_TEXT_RE)
  return m ? (NAME_TO_2.get(m[1]) ?? '') : ''
}

// text → 'mobile'|'desktop'|'tablet'|'' (bỏ 'other'). Thử normalizeDevice sạch; rồi quét từ khóa.
export function extractDeviceFromText(value, valueMap = null) {
  const clean = normalizeDevice(value, valueMap)
  if (clean && clean !== 'other') return clean
  if (value === null || value === undefined) return ''
  const low = String(value).toLowerCase()
  if (/\b(tablet|ipad)\b/.test(low)) return 'tablet'
  if (/\b(mobile|phone|android|iphone|ios|smartphone)\b/.test(low)) return 'mobile'
  if (/\b(desktop|laptop|computer|pc)\b/.test(low)) return 'desktop'
  return ''
}
