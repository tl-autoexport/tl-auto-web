export type PowerResolution = {
  powerHp: number;
  source: string;
  note?: string;
};

export type VehicleIdentityInput = {
  brand?: string | null;
  model?: string | null;
  badge?: string | null;
  badgeDetail?: string | null;
  fuelType?: string | null;
  driveType?: string | null;
  engineCc?: number | null;
  year?: number | null;
};

type VerifiedSpec = {
  brand: string;
  model: string;
  badgeDetail: string;
  fuelType: string;
  engineCc: number;
  driveType?: string | null;
  powerHp: number;
  source?: string;
};

const BRAND_MAP: Record<string, string> = {
  현대: "Hyundai",
  기아: "Kia",
  제네시스: "Genesis",
  쉐보레: "Chevrolet",
  "쉐보레(GM대우)": "Chevrolet",
  "르노코리아(삼성)": "Renault Korea",
  르노코리아: "Renault Korea",
  쌍용: "SsangYong",
  KG모빌리티: "KGM",
  "KG모빌리티(쌍용)": "KGM",
  도요타: "Toyota",
  토요타: "Toyota",
  렉서스: "Lexus",
  닛산: "Nissan",
  혼다: "Honda",
  테슬라: "Tesla",
  푸조: "Peugeot",
  벤츠: "Mercedes-Benz",
  아우디: "Audi",
  폭스바겐: "Volkswagen",
  볼보: "Volvo",
  포르쉐: "Porsche",
  마세라티: "Maserati",
  링컨: "Lincoln",
  랜드로버: "Land Rover",
  미니: "MINI",
  BMW: "BMW",
  ChevroletGMDaewoo: "Chevrolet",
};

const MODEL_MAP: Record<string, string> = {
  "벤츠 C클래스": "C-Class",
  "벤츠 A클래스": "A-Class",
  "벤츠 E클래스": "E-Class",
  "벤츠 S클래스": "S-Class",
  "A클래스": "A-Class",
  "C클래스": "C-Class",
  "E클래스": "E-Class",
  "S클래스": "S-Class",
  "CLA클래스": "CLA",
  "CLS클래스": "CLS",
  "미니 쿠퍼 3세대": "Cooper",
  "미니 쿠퍼": "Cooper",
  "혼다 어코드": "Accord",
  "더 뉴 기아 레이": "Ray",
  레이: "Ray",
  스파크: "Spark",
  "더 뉴 스파크": "Spark",
  "더 넥스트 스파크": "Spark",
  "트랙스 크로스오버": "Trax",
  "더 뉴 트랙스": "Trax",
  트랙스: "Trax",
  트레일블레이저: "Trailblazer",
  크루즈: "Cruze",
  캐스퍼: "Casper",
  Casper: "Casper",
  Spark: "Spark",
  Ray: "Ray",
  "디스커버리 스포츠": "Discovery Sport",
  "Discovery Sport": "Discovery Sport",
  르반떼: "Levante",
  기블리: "Ghibli",
  타이칸: "Taycan",
  "디 올 뉴 니로 EV": "Niro EV",
  "니로 플러스": "Niro Plus",
  "니로 EV": "Niro EV",
  아이오닉6: "Ioniq 6",
  "볼트 EUV": "Bolt EUV",
  "모델 Y": "Model Y",
  돌핀: "Dolphin",
  아이오닉5: "Ioniq 5",
  "Ioniq 5": "Ioniq 5",
  "모델 3": "Model 3",
  "Model 3": "Model 3",
  "푸조 2008": "2008",
  2008: "2008",
  "모하비 더 마스터": "Mohave",
  모하비: "Mohave",
  Mohave: "Mohave",
  시에나: "Sienna",
  Sienna: "Sienna",
  "3시리즈": "3 Series",
  "3 Series": "3 Series",
  "3-Series": "3 Series",
  "4시리즈": "4 Series",
  "4 Series": "4 Series",
  "4-Series": "4 Series",
  "5시리즈": "5 Series",
  "5 Series": "5 Series",
  "5-Series": "5 Series",
  "7시리즈": "7 Series",
  "7 Series": "7 Series",
  "7-Series": "7 Series",
  "A-클래스": "A-Class",
  "A-Class": "A-Class",
  "C-클래스": "C-Class",
  "C-Class": "C-Class",
  "E-클래스": "E-Class",
  "E-Class": "E-Class",
  "S-클래스": "S-Class",
  "S-Class": "S-Class",
  CLA: "CLA",
  CLS: "CLS",
  GLC300: "GLC",
  "GLC 300": "GLC",
  GLC: "GLC",
  GLE450: "GLE",
  GLE: "GLE",
  GLS: "GLS",
  투싼: "Tucson",
  Tucson: "Tucson",
  스포티지: "Sportage",
  Sportage: "Sportage",
  싼타페: "Santa Fe",
  "Santa Fe": "Santa Fe",
  쏘렌토: "Sorento",
  소렌토: "Sorento",
  Sorento: "Sorento",
  셀토스: "Seltos",
  Seltos: "Seltos",
  베뉴: "Venue",
  Venue: "Venue",
  팰리세이드: "Palisade",
  Palisade: "Palisade",
  코나: "Kona",
  Kona: "Kona",
  카니발: "Carnival",
  Carnival: "Carnival",
  Canival: "Carnival",
  스타리아: "Staria",
  Staria: "Staria",
  스타렉스: "Starex",
  Starex: "Starex",
  그랜저: "Grandeur",
  "더 뉴 그랜저": "Grandeur",
  Grandeur: "Grandeur",
  쏘나타: "Sonata",
  Sonata: "Sonata",
  아반떼: "Elantra",
  Elantra: "Elantra",
  스팅어: "Stinger",
  Stinger: "Stinger",
  K3: "K3",
  K5: "K5",
  K7: "K7",
  "K7 프리미어": "K7",
  K8: "K8",
  K9: "K9",
  "더 뉴 K9": "K9",
  G70: "G70",
  G80: "G80",
  G90: "G90",
  EQ900: "EQ900",
  GV60: "GV60",
  GV70: "GV70",
  GV80: "GV80",
  렉스턴: "Rexton",
  토레스: "Torres",
  QM6: "QM6",
  XM3: "XM3",
  아르카나: "Arkana",
  "뉴 SM3": "SM3",
  SM3: "SM3",
  모닝: "Morning",
  액티언: "Actyon",
  아테온: "Arteon",
  X7: "X7",
  Cooper: "Cooper",
  Countryman: "Countryman",
  Colorado: "Colorado",
  XC40: "XC40",
  Arteon: "Arteon",
  Crown: "Crown",
};

const COLOR_MAP: Record<string, string> = {
  흰색: "Белый",
  백색: "Белый",
  화이트: "Белый",
  검정색: "Черный",
  검은색: "Черный",
  블랙: "Черный",
  회색: "Серый",
  그레이: "Серый",
  쥐색: "Темно-серый",
  은색: "Серебристый",
  은하색: "Серебристый",
  실버: "Серебристый",
  파란색: "Синий",
  청색: "Синий",
  빨간색: "Красный",
  적색: "Красный",
  갈색: "Коричневый",
  녹색: "Зеленый",
  베이지: "Бежевый",
  카키: "Хаки",
  네이비: "Темно-синий",
  남색: "Темно-синий",
  블루: "Синий",
  파랑: "Синий",
  노란색: "Желтый",
  옐로: "Желтый",
  주황색: "Оранжевый",
  오렌지: "Оранжевый",
  보라색: "Фиолетовый",
  퍼플: "Фиолетовый",
  와인: "Бордовый",
  골드: "Золотистый",
  민트: "Мятный",
};

const VERIFIED_SPECS: VerifiedSpec[] = [
  {
    brand: "Hyundai",
    model: "Casper",
    badgeDetail: "1.0",
    fuelType: "gasoline",
    engineCc: 998,
    powerHp: 76,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Ray",
    badgeDetail: "1.0",
    fuelType: "gasoline",
    engineCc: 998,
    powerHp: 76,
    source: "verified_specs",
  },
  {
    brand: "Chevrolet",
    model: "Spark",
    badgeDetail: "1.0",
    fuelType: "gasoline",
    engineCc: 995,
    powerHp: 75,
    source: "verified_specs",
  },
  {
    brand: "Chevrolet",
    model: "Spark",
    badgeDetail: "1.0",
    fuelType: "gasoline",
    engineCc: 999,
    powerHp: 75,
    source: "verified_specs",
  },
  {
    brand: "Toyota",
    model: "Sienna",
    badgeDetail: "2.5 Hybrid 2WD",
    fuelType: "gasoline",
    engineCc: 2487,
    powerHp: 189,
    source: "verified_specs",
  },
  {
    brand: "Toyota",
    model: "Sienna",
    badgeDetail: "2.5 Hybrid 2WD",
    fuelType: "hybrid",
    engineCc: 2487,
    powerHp: 189,
    source: "verified_specs",
  },
  {
    brand: "BMW",
    model: "3 Series",
    badgeDetail: "320d",
    fuelType: "diesel",
    engineCc: 1995,
    powerHp: 190,
    source: "verified_specs",
  },
  {
    brand: "BMW",
    model: "3 Series",
    badgeDetail: "320i",
    fuelType: "gasoline",
    engineCc: 1998,
    powerHp: 184,
    source: "verified_specs",
  },
  {
    brand: "BMW",
    model: "5 Series",
    badgeDetail: "523d",
    fuelType: "diesel",
    engineCc: 1995,
    powerHp: 190,
    source: "verified_specs",
  },
  {
    brand: "BMW",
    model: "5 Series",
    badgeDetail: "520i",
    fuelType: "gasoline",
    engineCc: 1998,
    powerHp: 190,
    source: "verified_specs",
  },
  {
    brand: "BMW",
    model: "X3",
    badgeDetail: "xDrive 20d",
    fuelType: "diesel",
    engineCc: 1995,
    driveType: "4WD",
    powerHp: 197,
    source: "verified_specs",
  },
  {
    brand: "BMW",
    model: "X4",
    badgeDetail: "xDrive20i",
    fuelType: "gasoline",
    engineCc: 1998,
    driveType: "4WD",
    powerHp: 184,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "Q2",
    badgeDetail: "35 TDI",
    fuelType: "diesel",
    engineCc: 1968,
    powerHp: 150,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "Q3",
    badgeDetail: "35 TDI",
    fuelType: "diesel",
    engineCc: 1968,
    powerHp: 150,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "A5",
    badgeDetail: "40 TFSI",
    fuelType: "gasoline",
    engineCc: 1984,
    driveType: "4WD",
    powerHp: 204,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "A8",
    badgeDetail: "50 TDI",
    fuelType: "diesel",
    engineCc: 2967,
    driveType: "4WD",
    powerHp: 286,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "A8",
    badgeDetail: "55 TFSI",
    fuelType: "gasoline",
    engineCc: 2995,
    driveType: "4WD",
    powerHp: 340,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "A8",
    badgeDetail: "60 TFSI",
    fuelType: "gasoline",
    engineCc: 3996,
    driveType: "4WD",
    powerHp: 460,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "A6",
    badgeDetail: "40 TDI",
    fuelType: "diesel",
    engineCc: 1968,
    powerHp: 204,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "A6",
    badgeDetail: "45 TDI",
    fuelType: "diesel",
    engineCc: 2967,
    driveType: "4WD",
    powerHp: 245,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "A6",
    badgeDetail: "45 TFSI",
    fuelType: "gasoline",
    engineCc: 1984,
    powerHp: 265,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "Q5",
    badgeDetail: "45 TFSI",
    fuelType: "gasoline",
    engineCc: 1984,
    driveType: "4WD",
    powerHp: 265,
    source: "verified_specs",
  },
  {
    brand: "Audi",
    model: "Q8",
    badgeDetail: "55 TFSI",
    fuelType: "gasoline",
    engineCc: 2995,
    driveType: "4WD",
    powerHp: 340,
    source: "verified_specs",
  },
  {
    brand: "Mercedes-Benz",
    model: "A-Class",
    badgeDetail: "AMG A35",
    fuelType: "gasoline",
    engineCc: 1991,
    powerHp: 306,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Grandeur",
    badgeDetail: "2.5",
    fuelType: "gasoline",
    engineCc: 2497,
    powerHp: 198,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Grandeur",
    badgeDetail: "Exclusive",
    fuelType: "hybrid",
    engineCc: 1598,
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Sonata",
    badgeDetail: "2.0",
    fuelType: "gasoline",
    engineCc: 1999,
    powerHp: 160,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Sonata",
    badgeDetail: "1.6 Turbo",
    fuelType: "gasoline",
    engineCc: 1598,
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Elantra",
    badgeDetail: "1.6",
    fuelType: "gasoline",
    engineCc: 1598,
    powerHp: 123,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Elantra",
    badgeDetail: "2.0 N",
    fuelType: "gasoline",
    engineCc: 1998,
    powerHp: 280,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Tucson",
    badgeDetail: "Gasoline 1.6 Turbo 2WD",
    fuelType: "gasoline",
    engineCc: 1598,
    driveType: "2WD",
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Tucson",
    badgeDetail: "Gasoline 1.6 Turbo 4WD",
    fuelType: "gasoline",
    engineCc: 1598,
    driveType: "4WD",
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Tucson",
    badgeDetail: "Diesel 2.0 2WD",
    fuelType: "diesel",
    engineCc: 1998,
    driveType: "2WD",
    powerHp: 186,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Santa Fe",
    badgeDetail: "Gasoline 2.5T 2WD",
    fuelType: "gasoline",
    engineCc: 2497,
    driveType: "2WD",
    powerHp: 281,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Santa Fe",
    badgeDetail: "Gasoline 2.5T 4WD",
    fuelType: "gasoline",
    engineCc: 2497,
    driveType: "4WD",
    powerHp: 281,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Santa Fe",
    badgeDetail: "Diesel 2.2 2WD",
    fuelType: "diesel",
    engineCc: 2151,
    driveType: "2WD",
    powerHp: 202,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Santa Fe",
    badgeDetail: "Diesel 2.2 4WD",
    fuelType: "diesel",
    engineCc: 2151,
    driveType: "4WD",
    powerHp: 202,
    source: "verified_specs",
  },
  {
    brand: "Hyundai",
    model: "Venue",
    badgeDetail: "1.6",
    fuelType: "gasoline",
    engineCc: 1598,
    powerHp: 123,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "K8",
    badgeDetail: "2.5 Gasoline 2WD",
    fuelType: "gasoline",
    engineCc: 2497,
    driveType: "2WD",
    powerHp: 198,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "K8",
    badgeDetail: "Signature",
    fuelType: "hybrid",
    engineCc: 1598,
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "K8",
    badgeDetail: "3.5 Gasoline 2WD",
    fuelType: "gasoline",
    engineCc: 3470,
    driveType: "2WD",
    powerHp: 300,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "K5",
    badgeDetail: "2.0",
    fuelType: "gasoline",
    engineCc: 1999,
    powerHp: 160,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "K5",
    badgeDetail: "1.6 Turbo",
    fuelType: "gasoline",
    engineCc: 1598,
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "K5",
    badgeDetail: "Signature",
    fuelType: "hybrid",
    engineCc: 1999,
    powerHp: 152,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Seltos",
    badgeDetail: "Gasoline 1.6 Turbo 2WD",
    fuelType: "gasoline",
    engineCc: 1598,
    driveType: "2WD",
    powerHp: 198,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Seltos",
    badgeDetail: "Gasoline 1.6 Turbo 4WD",
    fuelType: "gasoline",
    engineCc: 1591,
    driveType: "4WD",
    powerHp: 177,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Seltos",
    badgeDetail: "Diesel 1.6 2WD",
    fuelType: "diesel",
    engineCc: 1598,
    driveType: "2WD",
    powerHp: 136,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Seltos",
    badgeDetail: "Gasoline 2.0 2WD",
    fuelType: "gasoline",
    engineCc: 1999,
    driveType: "2WD",
    powerHp: 149,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Sportage",
    badgeDetail: "Gasoline 1.6 Turbo 2WD",
    fuelType: "gasoline",
    engineCc: 1598,
    driveType: "2WD",
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Sportage",
    badgeDetail: "Gasoline 1.6 Turbo 4WD",
    fuelType: "gasoline",
    engineCc: 1598,
    driveType: "4WD",
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Sportage",
    badgeDetail: "Diesel 2.0 2WD",
    fuelType: "diesel",
    engineCc: 1995,
    driveType: "2WD",
    powerHp: 186,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Sportage",
    badgeDetail: "Diesel 2.0 4WD",
    fuelType: "diesel",
    engineCc: 1998,
    driveType: "4WD",
    powerHp: 186,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Sportage",
    badgeDetail: "LPG 2.0 2WD",
    fuelType: "lpg",
    engineCc: 1999,
    driveType: "2WD",
    powerHp: 146,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Carnival",
    badgeDetail: "9-Seater Prestige",
    fuelType: "diesel",
    engineCc: 2151,
    powerHp: 202,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Carnival",
    badgeDetail: "Gasoline 7-Seater",
    fuelType: "gasoline",
    engineCc: 3470,
    powerHp: 294,
    source: "verified_specs",
  },
  {
    brand: "Kia",
    model: "Carnival",
    badgeDetail: "HEV",
    fuelType: "hybrid",
    engineCc: 1598,
    powerHp: 180,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "G70",
    badgeDetail: "2.0T",
    fuelType: "gasoline",
    engineCc: 1998,
    powerHp: 252,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "G70",
    badgeDetail: "3.3T Sport AWD",
    fuelType: "gasoline",
    engineCc: 3342,
    driveType: "4WD",
    powerHp: 370,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "G80",
    badgeDetail: "2.5T",
    fuelType: "gasoline",
    engineCc: 2497,
    powerHp: 304,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "G80",
    badgeDetail: "3.5 Turbo AWD",
    fuelType: "gasoline",
    engineCc: 3470,
    driveType: "4WD",
    powerHp: 380,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "GV70",
    badgeDetail: "2.5T Gasoline AWD",
    fuelType: "gasoline",
    engineCc: 2497,
    driveType: "4WD",
    powerHp: 304,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "GV70",
    badgeDetail: "2.2 Diesel 2WD",
    fuelType: "diesel",
    engineCc: 2151,
    driveType: "2WD",
    powerHp: 202,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "GV80",
    badgeDetail: "2.5T",
    fuelType: "gasoline",
    engineCc: 2497,
    powerHp: 304,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "GV80",
    badgeDetail: "3.0 Diesel 2WD",
    fuelType: "diesel",
    engineCc: 2996,
    driveType: "2WD",
    powerHp: 278,
    source: "verified_specs",
  },
  {
    brand: "Genesis",
    model: "GV80",
    badgeDetail: "3.5T Gasoline AWD",
    fuelType: "gasoline",
    engineCc: 3470,
    driveType: "4WD",
    powerHp: 380,
    source: "verified_specs",
  },
];

const VERIFIED_BADGE_POWER_MAP: Record<string, number> = {
  "2.5 hybrid 2wd_2481": 189,
  "2.5 hybrid 2wd_2487": 189,
  "diesel 2.2 4wd_2199": 202,
  "diesel 3.0 4wd 6-seater_2959": 250,
  "xdrive 40i m sport 7str_2998": 340,
  "xdrive40i m sport_2998": 340,
  "glc300 4matic coupe_1991": 258,
  "glc300 4matic_1991": 258,
  "glc220d 4matic coupe_1950": 194,
  "glc220 d 4matic coupe_1950": 194,
  "glc220d 4matic_1950": 194,
  "glc220d 4matic coupe_1993": 194,
  "glc220d 4matic_1993": 194,
  "gle300d 4matic_1993": 245,
  "gle400d 4matic_2925": 330,
  "gle400d 4matic coupe_2925": 330,
  "gle450 4matic_2999": 367,
  "gls400d 4matic_2925": 330,
  "gls450 4matic_2999": 367,
  "c200 avantgarde_1999": 204,
  "c200 4matic avantgarde_1999": 204,
  "c220d avantgarde_1993": 200,
  "c220d 4matic avantgarde_1993": 200,
  "c300 amg line_1999": 258,
  "c200 cabriolet_1991": 204,
  "c200 coupe_1991": 204,
  "c300 4matic avantgarde_1999": 258,
  "e200 avantgarde_1999": 204,
  "e220d 4matic exclusive_1950": 200,
  "e220d 4matic amg line_1950": 200,
  "e250 exclusive_1991": 211,
  "e220d avantgarde_1950": 194,
  "e220d 4matic avantgarde_1950": 194,
  "e220d exclusive_1950": 194,
  "e300 4matic amg line_1999": 258,
  "s350d 4matic_2925": 286,
  "s350 d 4matic_2989": 286,
  "s400d 4matic_2925": 330,
  "s400 d 4matic_2925": 330,
  "s450 4matic_2999": 367,
  "s500 4matic_2999": 435,
  "a220 sedan_1991": 190,
  "a250 4matic sedan_1991": 224,
  "amg a35 4matic sedan_1991": 306,
  "amg glc43 4matic coupe_2996": 390,
  "glb200 d_1950": 150,
  "glb220_1991": 190,
  "glb250 4matic_1991": 224,
  "xdrive 20 m sport pro_1998": 184,
  "xdrive 20 m sport_1998": 184,
  "xdrive 20i_1998": 184,
  "xdrive 20i m sport_1998": 184,
  "xdrive 20i m sports pro_1998": 184,
  "xdrive 20i m sport pro_1998": 184,
  "530i xdrive m sport package_1998": 252,
  "530i xdrive m sport_1998": 252,
  "530i xdrive luxury_1998": 252,
  "420i m sport pro convertible_1998": 184,
  "xdrive30d m sport_2993": 286,
  "m2 coupe_2993": 460,
  "45 tdi quattro_2967": 231,
  "40 tfsi premium_1984": 204,
  "2.0 tdi prestige_1968": 200,
  "1.4 tsi prestige_1395": 150,
  "3.0 coupe_2995": 340,
  "3.0_2995": 340,
  "4.0 turbo_3996": 550,
  "2.9 s_2995": 354,
  "2.9 awd platinum edition_2894": 330,
  "p250 se_1997": 249,
  "p250 s_1997": 249,
  "gasoline 1.6 turbo 2wd_1598": 180,
  "gasoline 2.5t 2wd_2497": 281,
  "2.5 gasoline 2wd_2497": 198,
  "1.6 turbo_1598": 180,
  "2.5 gdi noblesse_2497": 198,
  "2.0 td4 hse luxury_1999": 180,
  "1.6 bluehdi feline_1560": 99,
  "1.6 premium_1598": 123,
  "premium 2wd_1598": 180,
  "diesel 2.2 4wd_2151": 202,
};

const VERIFIED_MODEL_POWER_MAP: Record<string, number> = {
  hyundai_palisade_2199: 202,
  kia_mohave_2959: 250,
  toyota_sienna_2481: 189,
  toyota_sienna_2487: 189,
  bmw_x7_2998: 340,
  mercedesbenz_glc_1991: 258,
  mercedesbenz_eclass_1999: 204,
  mercedesbenz_aclass_1991: 306,
  kia_sportage_1598: 180,
  kia_sorento_2497: 281,
  kia_k8_2497: 198,
  kia_k7_2497: 198,
  hyundai_sonata_1598: 180,
  hyundai_venue_1598: 123,
  hyundai_casper_998: 76,
  hyundai_tucson_1598: 180,
  hyundai_grandeur_2359: 159,
  chevrolet_spark_999: 75,
  landrover_discoverysport_1999: 180,
  peugeot_2008_1560: 99,
};

// Encar sometimes omits displacement from the list payload. These are the
// conservative, source-backed defaults used by the previous Autoexport
// catalog when a trim does not expose a separate engine size. They are only a
// last resort; an explicit displacement or a badge value always wins.
const VERIFIED_MODEL_ENGINE_MAP: Record<string, number> = {
  hyundai_casper: 998,
  hyundai_ray: 998,
  chevrolet_spark: 999,
  kia_k3: 1591,
  kia_k5: 1999,
  kia_k7: 2497,
  kia_k8: 2497,
  kia_k9: 3470,
  kia_seltos: 1598,
  kia_sportage: 1598,
  kia_sorento: 2497,
  kia_mohave: 2959,
  kia_carnival: 2151,
  hyundai_sonata: 1999,
  hyundai_elantra: 1598,
  hyundai_grandeur: 2497,
  hyundai_tucson: 1598,
  hyundai_santafe: 2497,
  hyundai_palisade: 2199,
  hyundai_venue: 1598,
  hyundai_kona: 1598,
  hyundai_staria: 2199,
  hyundai_starex: 2497,
  genesis_g70: 1998,
  genesis_g80: 2497,
  genesis_g90: 3470,
  genesis_gv70: 2497,
  genesis_gv80: 2497,
  bmw_3series: 1998,
  bmw_5series: 1998,
  bmw_7series: 2998,
  bmw_x7: 2998,
  "mercedesbenz_eclass": 1999,
  "mercedesbenz_cclass": 1999,
  "mercedesbenz_sclass": 2999,
  mercedesbenz_glc: 1991,
  mercedesbenz_gle: 1993,
  audi_a6: 1984,
  volkswagen_tiguan: 1968,
  landrover_discoverysport: 1999,
  landrover_rangerovervelar: 2996,
  maserati_levante: 1998,
  kia_morning: 998,
  kia_stinger: 3342,
  lincoln_navigator: 3496,
  mini_cooper: 1499,
  mini_countryman: 1998,
  peugeot_2008: 1560,
};

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlate(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .trim();
}

export function normalizeBrand(value: unknown) {
  const raw = String(value ?? "").trim();
  return (BRAND_MAP[raw] ?? raw) || null;
}

export function normalizeModel(value: unknown) {
  const raw = String(value ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("glc")) return "GLC";
  if (lower.includes("gle")) return "GLE";
  if (lower.includes("gls")) return "GLS";
  if (lower.includes("glb")) return "GLB";
  if (lower.includes("gla")) return "GLA";
  for (const [from, to] of Object.entries(MODEL_MAP).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (raw.includes(from)) return to;
  }
  return raw || null;
}

function modelPowerKey(brand: string, model: string, engineCc: number) {
  const brandKey = normalizeText(brand).replace(/\s+/g, "").replace(/-/g, "");
  const modelKey = normalizeText(model)
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
  return `${brandKey}_${modelKey}_${engineCc}`;
}

function modelEngineKey(brand: string, model: string) {
  const brandKey = normalizeText(brand).replace(/\s+/g, "").replace(/-/g, "");
  const modelKey = normalizeText(model)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
  return `${brandKey}_${modelKey}`;
}

export function resolveEngineCc(input: VehicleIdentityInput) {
  const explicit = Number(input.engineCc) || 0;
  if (explicit > 0) return explicit;
  if (normalizeFuel(input.fuelType) === "electric") return null;

  const brand = normalizeBrand(input.brand);
  const model = normalizeModel(input.model);
  if (!brand || !model) return null;

  const badgeText = [input.badgeDetail, input.badge]
    .filter(Boolean)
    .join(" ");
  const ccMatch = badgeText.match(/(\d{3,4})\s*(?:cc|㎤|시시)/i);
  if (ccMatch) return Number(ccMatch[1]);
  const litreMatch = badgeText.match(/(?:^|\s)(\d(?:[.,]\d{1,2})?)(?=\s*(?:T|터보|HEV|하이브리드|AWD|FWD|2WD|4WD|L|GDI|TFSI|TSI|GT|D\d{2,3}|$))/i);
  if (litreMatch) {
    const litres = Number(litreMatch[1].replace(",", "."));
    if (litres >= 0.6 && litres <= 8) return Math.round(litres * 1000);
  }

  const matchingSpecs = VERIFIED_SPECS.filter((item) => {
    if (normalizeText(item.brand) !== normalizeText(brand)) return false;
    if (normalizeText(item.model) !== normalizeText(model)) return false;
    const fuel = normalizeFuel(input.fuelType);
    return !item.fuelType || !fuel || normalizeFuel(item.fuelType) === fuel;
  });
  const distinctEngines = [...new Set(matchingSpecs.map((item) => item.engineCc))];
  if (distinctEngines.length === 1) return distinctEngines[0];

  return VERIFIED_MODEL_ENGINE_MAP[modelEngineKey(brand, model)] ?? null;
}

export function normalizeColor(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const baseColor = Object.entries(COLOR_MAP)
    .sort(([left], [right]) => right.length - left.length)
    .find(([source]) => raw.includes(source))?.[1];

  if (baseColor) {
    return raw.includes("매트")
      ? `Матовый ${baseColor.toLowerCase()}`
      : baseColor;
  }

  // The public site must not leak a Korean-only source value into a Russian card.
  return /[\uac00-\ud7af]/.test(raw) ? null : raw;
}

export function normalizeFuel(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const hasElectric = text.includes("전기") || text.includes("electric");
  const hasCombustion =
    text.includes("가솔린") ||
    text.includes("휘발유") ||
    text.includes("gasoline") ||
    text.includes("petrol") ||
    text.includes("디젤") ||
    text.includes("경유") ||
    text.includes("diesel");

  // Encar can describe hybrids as "가솔린+전기" without saying "hybrid".
  if (hasElectric && hasCombustion) return "hybrid";
  if (text.includes("디젤") || text.includes("diesel") || text.includes("경유"))
    return "diesel";
  if (text.includes("lpg") || text.includes("lpi") || text.includes("lpe"))
    return "lpg";
  if (
    text.includes("하이브리드") ||
    text.includes("hybrid") ||
    text.includes("hev")
  )
    return "hybrid";
  if (text.includes("전기") || text.includes("electric")) return "electric";
  if (
    text.includes("가솔린") ||
    text.includes("gasoline") ||
    text.includes("휘발유")
  )
    return "gasoline";
  return text;
}

export function isElectrifiedConfiguration(input: VehicleIdentityInput) {
  const brand = normalizeBrand(input.brand);
  const fuelType = normalizeFuel(input.fuelType);
  const badge = normalizeText(
    [input.badge, input.badgeDetail].filter(Boolean).join(" "),
  );

  if (fuelType !== "gasoline" && fuelType !== "diesel") return true;
  if (
    /(hybrid|phev|mhev|plug[- ]?in|하이브리드|플러그인|마일드)/i.test(badge)
  )
    return true;
  if (brand === "Volvo" && /\bb[456]\b/i.test(badge)) return true;
  if (
    brand === "Mercedes-Benz" &&
    /\b(e350|e450|e53|s450|s500|s580|gle450|gle53|gls450|gls580|gt43)\b/i.test(
      badge,
    )
  )
    return true;
  if (
    brand === "BMW" &&
    /\b(m440i|740i|m850i|xdrive ?40i)\b/i.test(badge)
  )
    return true;
  if (
    brand === "Audi" &&
    /\b(55 tfsi|rsq8)\b/i.test(badge)
  )
    return true;
  if (
    brand === "Land Rover" &&
    /\bp360\b/i.test(badge)
  )
    return true;

  return false;
}

function normalizeBadgeForPower(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/가솔린/g, "gasoline")
    .replace(/디젤/g, "diesel")
    .replace(/하이브리드/g, "hybrid")
    .replace(/터보/g, "turbo")
    .replace(/쿠페/g, "coupe")
    .replace(/세단/g, "sedan")
    .replace(/시그니처/g, "signature")
    .replace(/프리미엄/g, "premium")
    .replace(/노블레스/g, "noblesse")
    .replace(/럭셔리/g, "luxury")
    .replace(/펠린/g, "feline")
    .replace(/인승/g, "-seater")
    .replace(/마스터/g, "master")
    .replace(/디 에센셜/g, "the essential")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDrive(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  if (
    text.includes("4wd") ||
    text.includes("awd") ||
    text.includes("xdrive") ||
    text.includes("quattro") ||
    text.includes("콰트로")
  )
    return "4WD";
  if (text.includes("2wd")) return "2WD";
  if (text.includes("fwd")) return "FWD";
  if (text.includes("rwd")) return "RWD";
  return null;
}

function badgeMatches(inputBadge: string, specBadge: string) {
  const input = normalizeText(inputBadge);
  const spec = normalizeText(specBadge);
  if (!input || !spec) return true;
  return (
    input.includes(spec) ||
    spec.includes(input) ||
    input.split(" ").some((part) => part.length > 2 && spec.includes(part))
  );
}

export function resolvePower(
  input: VehicleIdentityInput,
): PowerResolution | null {
  const brand = normalizeBrand(input.brand);
  const model = normalizeModel(input.model);
  const fuelType = normalizeFuel(input.fuelType);
  const driveType = normalizeDrive(input.driveType);
  const engineCc = Number(input.engineCc) || 0;
  const badgeText = [input.badgeDetail, input.badge].filter(Boolean).join(" ");

  if (!brand || !model || !engineCc || fuelType === "electric") return null;

  const spec = VERIFIED_SPECS.find((item) => {
    if (normalizeText(item.brand) !== normalizeText(brand)) return false;
    if (normalizeText(item.model) !== normalizeText(model)) return false;
    if (item.engineCc !== engineCc) return false;
    if (item.fuelType && fuelType && item.fuelType !== fuelType) return false;
    if (item.driveType && driveType && item.driveType !== driveType)
      return false;
    return badgeMatches(badgeText, item.badgeDetail);
  });

  if (spec) {
    return {
      powerHp: spec.powerHp,
      source: spec.source ?? "verified_specs",
      note: `${spec.brand} ${spec.model} ${spec.badgeDetail} ${spec.engineCc}`,
    };
  }

  const normalizedBadgeCandidates = [
    normalizeBadgeForPower(input.badgeDetail),
    normalizeBadgeForPower(input.badge),
    normalizeBadgeForPower(badgeText),
  ].filter(Boolean);
  const matchedBadge = normalizedBadgeCandidates.find(
    (badge) =>
      VERIFIED_BADGE_POWER_MAP[`${badge}_${engineCc}`] ??
      VERIFIED_BADGE_POWER_MAP[badge],
  );
  const badgePower = matchedBadge
    ? (VERIFIED_BADGE_POWER_MAP[`${matchedBadge}_${engineCc}`] ??
      VERIFIED_BADGE_POWER_MAP[matchedBadge])
    : null;
  if (badgePower) {
    return {
      powerHp: badgePower,
      source: "verified_power_map_badge",
      note: `${matchedBadge}_${engineCc}`,
    };
  }

  const modelPower = VERIFIED_MODEL_POWER_MAP[modelPowerKey(brand, model, engineCc)];
  if (modelPower) {
    return {
      powerHp: modelPower,
      source: "verified_power_map_model",
      note: `${brand} ${model} ${engineCc}`,
    };
  }

  const fallbackPower =
    engineCc <= 1000
      ? 75
      : engineCc <= 1400
        ? 100
        : engineCc <= 1600
          ? 130
          : engineCc <= 2000
            ? 150
            : engineCc <= 2500
              ? 200
              : engineCc <= 3000
                ? 250
                : 300;
  return {
    powerHp: fallbackPower,
    source: "engine_fallback",
    note: `${brand} ${model} ${engineCc}`,
  };
}

export function normalizeVehicle(input: VehicleIdentityInput) {
  const brand = normalizeBrand(input.brand);
  const model = normalizeModel(input.model);
  const fuelType = normalizeFuel(input.fuelType);
  const driveType = normalizeDrive(input.driveType);
  const power = resolvePower({
    ...input,
    brand,
    model,
    fuelType,
    driveType,
  });

  return {
    brand,
    model,
    fuelType,
    driveType,
    power,
  };
}
