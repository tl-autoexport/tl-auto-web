# New Encar power research — 2026-09-23

## Scope and safety

- Encar enrichment run: `f7e9cca4-33ca-4813-9152-b6d4f42045b9`.
- AutoHome query output: `output/tl-auto-new-encar-autohome.json`.
- Matcher output: `output/tl-auto-new-encar-autohome-matches.json`.
- Read-only research only. No database writes, reference-spec updates, calculations, or publication were performed.
- AutoHome results are treated as discovery hints, not Korean-market power evidence.

## Findings for candidate listings

| Encar listing IDs | Vehicle/configuration in matcher | Candidate evidence found | Assessment |
| --- | --- | --- | --- |
| `42698734`, `42734754` | BMW X3 G01, 2023, 1998 cc, gasoline, AWD, xDrive20i M Sport / M Sport Pro (both Encar pages verified) | Encar confirms 42698734 as xDrive20i M Sport Pro, 23/02, and 42734754 as xDrive20i M Sport, 23/09. BMW Korea's G01 specs give xDrive20i 184 PS, 1,998 cc and list both trims; its 2023 price list confirms M Sport Pro locally. | Very strong Korean-market candidate: **184 PS**. AutoHome's Chinese 184/224/252 PS variants are not interchangeable with Korean xDrive20i. |
| `42689327` | BMW X5 G05, 2024-09, gasoline, xDrive40i xLine (Encar detail verified) | Encar confirms exact badge, fuel, and 24/09 model year. BMW Korea's facelift launch states 381 PS for new X5 xDrive40i; its February 2024 price list includes xDrive40i xLine. | Best-supported candidate: **381 PS** for this Korean facelift configuration. AutoHome's 340 PS candidate is from an earlier Chinese-market 2022 spec and must not be transferred. Encar itself did not show engine power; no database/reference write was made. |
| `42740444` | BMW 5 Series G30, 2022-02, 1998 cc gasoline, 530i M Sport (Encar page verified) | Encar confirms 530i M Sport and 22/02 model year. BMW Korea's G30 launch gives 252 PS for 530i and documents M Sport; Drom's 2022 G30 catalog lists 252 PS for M Sport RWD and xDrive. | Very strong candidate: **252 PS**. Encar detail did not expose drivetrain in the captured view; both listed drive variants share 252 PS. Chinese 525Li/530Li power entries are not applicable. |
| `42643244` | Audi A6 C8, 2021-11 (2022 model year), 1984 cc gasoline, 45 TFSI quattro Premium (Encar page verified) | Encar confirms `21/11식 (22년형)`. Korean-market sources distinguish the later 2022 model-year updated 45 TFSI at 265 PS from the earlier 252 PS version. | Candidate: **265 PS** for this 2022 model-year listing. Do not apply the older 252 PS output solely because earlier C8 variants share the same badge. |
| `42650624` | Matcher grouped as Audi A6 C8 45 TFSI quattro Premium | Re-fetching this Encar URL returned displayed registration number `42643244`, same 21/11 (2022 model-year) quattro listing. | **Not an independent car.** Treat as stale/duplicate source ID pointing to `42643244`; exclude from distinct-candidate counts unless the original source snapshot proves another listing. |
| `42774881` | Audi A6 C8, 2021-10, gasoline, 45 TFSI (Encar page verified; badge has no quattro) | Encar confirms non-quattro `45 TFSI`, 21/10. Korean-market specs list the earlier non-quattro 45 TFSI at 252 PS; the later 265 PS output is a distinct model-year update. | Candidate: **252 PS** for this earlier configuration. Keep the 2022-model-year 265 PS rule separate. |
| `42696075` | Matcher grouped as Audi A6 C8 45 TFSI non-quattro | Re-fetching its URL returned displayed registration number `42694604`; opening that ID directly confirms the same separate non-quattro listing (21/06, gasoline, 45 TFSI Premium). | **Not an independent car.** Treat `42696075` as stale/duplicate and do not count it separately. Returned listing `42694604` is consistent with the earlier 252 PS configuration; this does not prove another car under ID `42696075`. |

The remaining `review`/`ambiguous` row counts are grouped by configuration, not individual listings: 3 review groups and 5 ambiguous groups contain 9 raw listing IDs; two of those IDs resolve to other displayed Encar IDs and must not be counted as distinct verified cars.

## Source references

### Primary Korean manufacturer sources

- BMW Korea, G01 X3/X4 launch and technical specs (xDrive20i, 1,998 cc, 184 PS; xLine/M Sport/M Sport Pro): https://www.press.bmwgroup.com/korea/article/detail/T0354632KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%EB%89%B4-x3-%EB%B0%8F-%EB%89%B4-x4-%EA%B5%AD%EB%82%B4-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C
- BMW Korea, September 2023 price list (shows X3 xDrive20i M Sport Pro trim): https://www.bmw.co.kr/content/dam/bmw/marketKR/bmw_co_kr/Pricelist/BMW_September_pricelist_0913.pdf.asset.1694747480366.pdf
- BMW Korea, G30 5 Series launch and specs (530i, 1,998 cc, 252 PS, M Sport Package): https://www.press.bmwgroup.com/korea/article/detail/T0268099KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-7%EC%84%B8%EB%8C%80-%EB%89%B4-5%EC%8B%9C%EB%A6%AC%EC%A6%88-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C
- BMW Korea, February 2024 price list (includes X5 xDrive40i xLine): https://www.bmw.co.kr/content/dam/bmw/marketKR/bmw_co_kr/Pricelist/BMW_February_pricelist.pdf.asset.1707881709774.pdf
- BMW Korea, facelift X5/X6 launch (states 381 PS for xDrive40i): https://www.press.bmwgroup.com/korea/article/detail/T0428819KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%ED%95%9C%EC%B8%B5-%EB%86%92%EC%9D%80-%EC%99%84%EC%84%B1%EB%8F%84%EC%9D%98-%EB%89%B4-x5-%EB%B0%8F-%EB%89%B4-x6-%EA%B5%AD%EB%82%B4-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C
- BMW Korea, X5 xDrive40i current Korean specs (381 PS): https://www.bmw.co.kr/ko/all-models/x-series/x5/bmw-x5.html
- BMW Korea, 2021 M135i xDrive launch (306 PS): https://www.press.bmwgroup.com/korea/article/detail/T0339915KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%EA%B3%A0%EC%84%B1%EB%8A%A5-m-%ED%8D%BC%ED%8F%AC%EB%A8%BC%EC%8A%A4-%EB%AA%A8%EB%8D%B8-m135i-xdrive-%EB%B0%8F-x2-m35i-%EC%B6%9C%EC%8B%9C
- BMW Korea, M235i xDrive Gran Coupe (306 PS): https://www.press.bmwgroup.com/korea/article/detail/T0312125KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%EC%B0%BD%EB%A6%BD-25%EC%A3%BC%EB%85%84-%EA%B8%B0%EB%85%90-7%EC%9B%94-%EC%98%A8%EB%9D%BC%EC%9D%B8-%ED%95%9C%EC%A0%95-%EC%97%90%EB%94%94%EC%85%98-2%EC%A2%85-%EC%B6%9C%EC%8B%9C
- Hyundai Korea, 2025 Palisade official specs (2.5T, 281 PS): https://www.hyundai.com/kr/ko/brand/brandstory/heritage/2025-palisade
- Kia Korea, Sorento specification (2.5T, 2,497 cc, 281 PS): https://www.kia.com/kr/vehicles/sorento/specification
- Kia Korea, November 2025 Sorento catalog (2.2 diesel 194 PS): https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/catalog/catalog_sorento.pdf
- Volkswagen Korea, 2025 Golf GTI launch (2.0 TSI, 245 PS): https://www.volkswagen.co.kr/ko/promotion_news/news/new-2025/2025-06-09.html
- Genesis Korea, GV70 launch specs (2.5T 304 PS, 3.5T 380 PS, diesel 2.2 210 PS): https://www.genesis.com/kr/ko/support/pr-center/detail.html?seq=0000000290
- Genesis Korea, current GV70 specs: https://www.genesis.com/kr/ko/models/gv70
- Renault Korea, 2024 XM3 price/spec PDF (TCe 260, 1,332 cc, 152 PS): https://www.renault.co.kr/upload/asset/price/price_NEW_XM3_E-TECH_HYBRID_202403.pdf
- Audi Korea-distributed 2020 A6 digital catalogue (original 45 TFSI variants, 252 PS): https://www.ucaro.co.kr/board_upload/tb_Board/2020_07_01_zauBFjVKYU.pdf
- Audi Korea-distributed 2021 A6 digital catalogue: https://admin-bayernauto.d2.co.kr/upload/catalDownload/20210423_MI9_1619188048383.pdf
- Korean-market 2021 A6 trim/spec table separating original and changed versions: https://www.carwiki.co.kr/model/10368_2021/%EC%95%84%EC%9A%B0%EB%94%94_A6_C8
- Korean-market 2022 A6 45 TFSI Premium specs (265 PS): https://web.getcha.kr/cars/%EC%95%84%EC%9A%B0%EB%94%94/A6?gradeId=10027&id=694
- Korean reporting on the A6 45 TFSI model-year power update to 265 PS: https://v.daum.net/v/kwe8uLr8Is

### Independent corroboration / pending primary source

- Encar listing, BMW X3 xDrive20i M Sport Pro, 2023-02: https://fem.encar.com/cars/detail/42698734
- Encar listing, BMW X3 xDrive20i M Sport, 2023-09: https://fem.encar.com/cars/detail/42734754
- Encar listing, BMW X5 xDrive40i xLine, 2024-09: https://fem.encar.com/cars/detail/42689327
- Encar listing, BMW 530i M Sport, 2022-02: https://fem.encar.com/cars/detail/42740444
- Encar listing, Audi A6 45 TFSI quattro Premium, 2021-11: https://fem.encar.com/cars/detail/42643244
- Encar listing, Audi A6 45 TFSI (non-quattro badge), 2021-10: https://fem.encar.com/cars/detail/42774881
- Drom, BMW X3 2021–2023 catalog: https://www.drom.ru/catalog/bmw/x3/2023/
- Drom, BMW 5 Series 2022 catalog: https://www.drom.ru/catalog/bmw/5-series/2022/
- Drom, Audi A6 2021 catalog, including South Korea market section: https://www.drom.ru/catalog/audi/a6/2021/
- Drom, Audi A6 South Korea catalog data, including 40 TDI quattro: https://www.drom.ru/catalog/audi/a6/2021/
- Audi Korea corporate-hosted exact 2022 model-year power-update press release was not located. The 252/265 PS split is corroborated by Korean-market model-year/trim sources and Audi-distributed catalogues; preserve that provenance and do not collapse both into one generic A6 45 TFSI rule.

## Batch-level result

- AutoHome query covered 11 series; 9 returned specs.
- 26 configurations mapped to AutoHome series; 102 did not map.
- 259 AutoHome specs were retrieved.
- Matcher returned 31 `no_match`, 3 `review`, and 5 `ambiguous` configuration groups across 39 cards.
- No AutoHome result was promoted or used to calculate a price.

## Triage of AutoHome `no_match` groups

These are source leads only. A manufacturer spec for a vehicle family does not by itself prove an individual listing's exact trim/model year; Encar detail still has to be checked before any evidence is approved.

| Encar listing IDs | Configuration | Korean-market source lead | Assessment |
| --- | --- | --- | --- |
| `42632515`, `42740829`, `42747581`, `42776166`, `42647730`, `42657915`, `42747590` | Hyundai Palisade LX3, 2025–2026, 2497 cc gasoline, 2WD/4WD | Hyundai Korea's 2025 Palisade specification lists Smartstream G2.5T, 2,497 cc, 281 PS and 2WD/AWD. | Strong candidate: **281 PS**. Confirm year/generation and badge against Encar; official page identifies the 2025 generation. |
| `42725909` | Kia Sorento, 2025, 2151 cc diesel, 2WD | Kia Korea's November 2025 catalog lists 2.2 diesel at 194 PS. | Strong candidate: **194 PS**; year, displacement and fuel align. Confirm Encar trim/year before evidence approval. |
| `42742414` | Kia Sorento, 2026, 2497 cc gasoline, 2WD | Kia Korea's current Sorento spec lists 2,497 cc 2.5T at 281 PS, with 2WD and 4WD variants. | Strong candidate: **281 PS**; confirm the exact 2026 spec/trim. |
| `42739878`, `42770930` | Volkswagen Golf GTI, 2025, 1984 cc gasoline | Volkswagen Korea's 2025 GTI release lists 2.0 TSI at 245 PS. | Strong Korean-market candidate: **245 PS** if Encar badge confirms GTI and the 2025 generation. |
| `42702067` | BMW 1 Series F40, 2021, M135i xDrive | BMW Korea's 2021 launch release identifies M135i xDrive and 306 PS. | Strong candidate: **306 PS**; source matches market/model/year. |
| `42712446` | BMW 2 Series Gran Coupe F44, 2022, M235i xDrive | BMW Korea materials list M235i xDrive Gran Coupe at 306 PS. | Strong candidate: **306 PS**; confirm exact F44 listing identity. |
| `42682722` | BMW X3 G01, 2024, xDrive20i M Sport, 1998 cc gasoline AWD | Korean-market G01 xDrive20i specs list 184 PS and 1,998 cc; BMW Korea's 2023 price list confirms the local xDrive20i trim lineup. | Strong candidate: **184 PS**; confirm 2024 production/model year and the listing badge. |
| `42663024` | BMW X5 G05, 2026, 2993 cc diesel, xDrive30d M Sport | BMW Korea's facelift X5 release lists xDrive30d at 298 PS. | Candidate: **298 PS**; confirm the exact 2026 variant and engine code. |
| `42657418` | BMW X5 G05, 2026, 2998 cc gasoline, xDrive40i M Sport Pro Special Edition | BMW Korea's facelift release lists xDrive40i at 381 PS. | Strong candidate: **381 PS**; confirm the exact badge/generation. |
| `42768855`, `42769682` | Audi A6 C8, 2022, 1968 cc diesel, 40 TDI quattro Premium | Drom's South Korea section for C8 sedan lists 40 TDI quattro at 204 PS through 2023. | Candidate: **204 PS**, but needs Audi Korea/importer or certification source; matcher engine displacement mismatch is a data/matching issue to inspect, not permission to relax matching. |
| `42633219`, `42735751`, `42744836`, `42768123` | Genesis GV70, 3.5T AWD, 3470 cc, 2022/2024 | Genesis Korea's GV70 launch/official spec lists 3.5T at 380 PS; the current spec page also lists 3.5T and 2WD/AWD. | Candidate: **380 PS**; resolve the unexplained engine-cc difference and verify model-year generation before approval. |
| `42636592`, `42641778` | Genesis GV70, 2021, 2.2 diesel, 2151 cc, 2WD | Genesis Korea's GV70 launch release lists diesel 2.2 at 210 PS. | Candidate: **210 PS**; verify 2021 trim/drive and reconcile 2151 cc with the source's exact engine displacement. |
| `42692650`, `42725194` | Genesis GV70, 2026, 2.5T, 2497 cc, 2WD | Current Genesis Korea spec lists 2.5T at 304 PS. | Candidate: **304 PS** only if the listing is the current facelift generation; confirm model year/engine code. |
| `42751183` | Renault Korea XM3, 2023, 1332 cc, 1.3 TCe RE Inspire | Renault Korea's 2024 XM3 price/spec PDF lists TCe 260, 1,332 cc, 152 PS. | Strong candidate: **152 PS**; confirm the 2023 listing's exact RE Inspire/TCe 260 badge. |
| `42670982` | BMW X3 G45, 2025, 1998 cc gasoline, badge xDrive30 M Sport Pro | Current BMW Korea X3 page advertises 20 xDrive at 190 PS, but does not establish that this Encar `xDrive30` badge is the same Korean configuration. | **Unresolved.** Need exact Encar identity/model code and model-year-specific Korean source; do not map by engine size alone. |
| `42665681` | BMW 2 Series U06, 2023, badge 220i Luxury | No matching Korean official spec located in this pass; U06 generation/badge pairing should be checked against Encar detail. | **Unresolved.** Confirm whether this is genuinely U06 or a mislabeled F44 listing before searching power. |
| `42732597` | BMW 2 Series F44, 2021, 218d Advantage | No matching Korean official source for this exact diesel trim/power found in this pass. Korean F44 launch materials found here describe 220d, not 218d. | **Unresolved.** Do not transfer another market's 218d rating; inspect VIN/type approval and Korean registration spec. |

## Next checks

1. Encar pages verified for BMW X3 `42698734`/`42734754`, BMW X5 `42689327`, BMW 530i `42740444`, Audi quattro `42643244`, and Audi non-quattro `42774881`. URLs for `42650624` and `42696075` resolve to different displayed registration IDs (`42643244`, `42694604`); they are not independently verified candidates.
2. Keep Audi rules split by model year: earlier 45 TFSI non-quattro → 252 PS; 2022 model-year 45 TFSI quattro → 265 PS. Do not merge them under a generic badge-only rule.
3. Reconcile accepted BMW/Audi candidates against approved TL Auto power evidence before any reference write. This report did not update the database, calculate prices, or publish cars.
4. For the 31 AutoHome `no_match` cards and 102 unmapped configurations, test additional source coverage/name mappings separately. `no_match` means no supported AutoHome match, not that the power is unknowable.

## Reference-manifest update

After review, three narrowly-scoped BMW rules were added to `data/power-reference/manufacturer-korea-v1.json` for the verified Encar configurations: G01 X3 xDrive20i M Sport/M Sport Pro (2023, 184 PS), G05 X5 xDrive40i xLine (2024, 381 PS), and G30 530i M Sport Package (2022, 252 PS). The rule ranges require the exact generation, badge, fuel, year and engine-size window; AWD is additionally required where the badge/configuration proves it. The manufacturer import dry-run and the repository check passed. No Supabase or car-card changes were made.

Audi was intentionally not added to the executable reference yet. The verified 21/11 Encar listing is labeled model year 2022 while the matcher/database currently carry registration year 2021; the 21/10 non-quattro listing may be either side of the Korean output update. The current match schema cannot represent production month or model year independently, and the same badge exists at both 252 and 265 PS. Adding a broad 2021 rule would therefore risk applying the wrong power to other cars. Add Audi only after the matcher can distinguish model year/production date or exact type approval resolves the variants.
