# Following one figure from the raw data to the plan

This traces one location and platform, **South East Indeed**, from the monthly
figures the app holds to the hires the PDF prints, naming the sheet and column
of the workings export at every step. Anyone can do the same for any other row.

The figures below come from an October 2026 SMR plan built on 18 September 2026
with the September plan's settings (budget £101,950, 30 hires, spending cap
multiple 2, window "year to date, last three months x2"). Your own plan will
show different numbers; the steps are the same. The workings export is the
place to check a live plan, because every figure there is a live formula.

## 1. The monthly figures. Sheet: **Data sources**

Every monthly figure the plan read, with where it came from, the date the data
was taken, whether it counts, and what it counts for.

South East Indeed:

| Month | Spend | Applications | Counts | Weight |
|---|---|---|---|---|
| Oct 2025 | £3,370.99 | 53 | yes | 0 |
| Nov 2025 | £1,453.53 | 26 | yes | 0 |
| Dec 2025 | £2,905.64 | 22 | yes | 0 |
| Jan 2026 | £2,172.31 | 31 | yes | 1 |
| Feb 2026 | £1,093.94 | 37 | yes | 1 |
| Mar 2026 | £7,128.69 | 38 | yes | 1 |
| Apr 2026 | £6,711.49 | 67 | yes | 1 |
| May 2026 | £6,097.71 | 74 | yes | 2 |
| Jun 2026 | £7,192.78 | 86 | yes | 2 |
| Jul 2026 | £7,122.23 | 44 | yes | 2 |
| Aug 2026 | £5,331.52 | 45 | **no: still settling** | 0 |

Two things decide the weight. A month counts at all only once it is settled: 31
days must have passed between its last day and the date the data was taken, so
applications recorded late are in. August was not, so it counts for nothing.
Then the window decides the rest: this plan used year to date with the last
three months counted twice, so 2025 is out and May, June and July count double.

## 2. The window figures. Sheet: **Blend inputs**

The weighted totals, then scaled back to the number of months in the window, so
a month counted twice does not look like extra evidence:

| | Figure | How |
|---|---|---|
| Weighted spend | £57,931.87 | each month's spend x its weight |
| Weighted applications | 581 | the same for applications |
| Weight added up | 10 | 1+1+1+1+2+2+2 |
| Months in window | 7 | January to July |
| Spend in the window | £40,552.31 | £57,931.87 x 7 / 10 |
| Applications in the window | 406.7 | 581 x 7 / 10 |
| **Historic cost per application** | **£99.71** | £40,552.31 / 406.7 |
| Usual monthly spend | £5,793.19 | the weighted average of the months it ran |

The same sheet, lower down, does this for every location on the platform
together, which gives **Indeed's figure for the role**: 2,440.9 applications on
£180,620.27, or £74.00, pulled towards the role benchmark of £48.20 by 35
applications of evidence, giving **£73.63**.

## 3. From the window figure to the planned cost. Sheet: **Workings**

Reading the South East Indeed row left to right:

| Column | Figure | How |
|---|---|---|
| Historic cost per application | £99.71 | from Blend inputs, step 2 |
| Platform figure for the role | £73.63 | from Blend inputs, step 2 |
| Usual cost per application | £97.64 | (406.7 x £99.71 + 35 x £73.63) / (406.7 + 35) |
| Thin-data adjustment | 0.979 | £97.64 / £99.71: this row has plenty of evidence, so it barely moved |
| Usual monthly spend | £5,793.19 | from Blend inputs |
| Cost rises with spend (rate) | 0.65 | the agreed rate, shared across platforms |
| Media spend | £7,057.91 | planned spend £7,181.42 / 1.0175, the Indeed fee taken off |
| Spend-level adjustment | 1.072 | (£7,057.91 / £5,793.19) ^ (1 − 0.65) |
| Remaining-error adjustment | 1.096 | what testing on past months still missed for SMR |
| **Planned cost per application (media)** | **£114.68** | £97.64 x 1.072 x 1.096 |
| Planned cost per application (total) | £116.68 | £114.68 x 1.0175, with the fee |
| **Applications** | **61.5** | £7,057.91 / £114.68 |

## 4. From applications to hires. Sheets: **Rate build-up**, then **Workings**

| | Figure | How |
|---|---|---|
| Indeed's own quality rate | 16.4% | 418 quality applications of 2,543, October 2025 to June 2026 |
| Role average, every source | 20.9% | 1,598 of 7,660, all sources together, same months |
| **Quality rate used** | **16.8%** | (418 + 200 x 20.9%) / (2,543 + 200): blended with the role average by 200 applications |
| Location quality adjustment | 1.00 | location differences are not applied this release |
| **Hire rate after quality** | **11.7%** | the role average (187 hires from 1,598 quality applications): 41 hires from 311 quality applications in the South East is its own figure, but regional differences did not carry forward in testing |
| Matching factor | 0.954 | so past predictions match the hires Eploy credited to the four platforms |
| Quality applications | 10.32 | 61.5 x 16.8% |
| **Hires** | **1.15** | 61.5 x 16.8% x 11.7% x 0.954 |

## 5. What limited the spend. Sheet: **Successful months**

Every month from January 2026 with at least £200 of spend and 5 applications is
tested, the same way whatever data window the plan uses:

- **Cost:** was its cost per application at or below the benchmark at that
  month's spend? The benchmark is this row's own usual cost per application over
  every settled month, each counted once (£93.31 on £4,524.93 a month), adjusted
  for the month's spend at the rate of 0.65. In June 2026, at £7,192.78, the
  benchmark was £109.74 and the month cost £83.64, so it passed. March (£187.60
  against £109.40) and July (£161.87 against £109.36) did not.
- **Limit:** was it within any cost per application limit? None was set.
- **Quality:** was the South East's quality rate that month no more than 25%
  below what was expected for it that month? The expected rate is its usual
  rate scaled by how that month's rate across all locations compared with usual.
  In June it was 19.1% against 17.4% expected, so it passed; in January it was
  15.0% against 21.7%, so January was set aside.

June 2026 was the largest month that passed, at £7,192.78, so the cap is
£7,192.78 x 2 (the spending cap multiple) plus the Indeed fee: **£14,637.31**.
This row was funded at £7,181.42, inside it.

## 6. The range. Sheet: **Back-test**

The plan's own range comes from how far it missed on past months, each
predicted from the months before it: for SMR, −19.3% to +20.5%. A row's range
starts there and widens where fewer applications sit behind its cost per
application, and where planned spend sits further from past spend. South East
Indeed, with 406.7 applications behind it, came out at **43 to 85
applications**, and **0 to 3 hires** once the uncertainty in the rates and the
chance variation in a small number of hires are added.

## 7. Where it appears

- **Plan tab and Platforms tab:** in the location and platform totals.
- **PDF:** on the Indeed page of "location and platform", one row per location,
  with the cost build-up, the cap, the rates and the ranges. The summary adds it
  into the plan totals.
- **Workings export:** the Workings sheet row above, with every figure a live
  formula pointing at the sheets in steps 1 to 6, so the arithmetic can be
  followed in the spreadsheet itself.

## Checking it yourself

1. Export the workings for the plan you are looking at.
2. Open the Workings sheet and find the row.
3. Click any figure: the formula bar shows where it comes from. Follow it back
   through Blend inputs to Data sources, and through Rate build-up to the
   applicant tracking counts.
4. Nothing in the workbook is a pasted answer. Every formula is worked out when
   the file opens, and an automatic check recalculates the whole workbook and
   compares all of them with the plan.
