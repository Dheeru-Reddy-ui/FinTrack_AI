# FinTrack AI — RAG agent eval report

**Run:** 2026-07-06 08:42 UTC · **Cases:** 13 · **Agent:** `chat` Edge Function (plan → SQL aggregation → pgvector → grounded phrasing)

| Metric | Score |
|---|---|
| **Numeric accuracy (deterministic check)** | **13/13 (100%)** |
| Correctness (LLM-as-Judge, 9 judged; 4 judge-unavailable) | 9/9 (100%) |
| Faithfulness (no invented figures) | 9/9 (100%) |

## Method
Ground truth is computed by the same deterministic SQL RPCs the agent uses (`agg_summary`, `agg_by_category`, `agg_top_txns`, `agg_merchant`) with **harness-fixed date ranges**, so expected answers are known independent of the agent's planner. Each question runs through the deployed agent; a deterministic check asserts the expected figures appear in the answer (±2%/₹50 for currency to absorb day-boundary drift, exact for counts), and a Gemini judge (temperature 0) scores correctness and faithfulness with reasons.

## Cases

| # | Case | Question | Numeric | Correct | Faithful | Judge note |
|---|---|---|---|---|---|---|
| 1 | groceries-last30 | How much did I spend on groceries in the last 30 days? | ✅ | ⚠️ n/a | — | judge unavailable (LLM quota) |
| 2 | total-lastmonth | How much did I spend in total last month? | ✅ | ✅ | ✅ | The total expense amount matches the ground truth exactly. |
| 3 | income-lastmonth | What was my income last month? | ✅ | ✅ | ✅ | The income figure matches the ground truth exactly. |
| 4 | savings-lastmonth | How much did I save last month? | ✅ | ⚠️ n/a | — | judge unavailable (LLM quota) |
| 5 | biggest-lastmonth | What was my single biggest expense last month? | ✅ | ⚠️ n/a | — | judge unavailable (LLM quota) |
| 6 | swiggy-count-last30 | How many Swiggy orders did I make in the last 30 days? | ✅ | ✅ | ✅ | The count and total amount match the ground truth exactly. |
| 7 | netflix-90d | How much have I spent on Netflix in the last 90 days? | ✅ | ⚠️ n/a | — | judge unavailable (LLM quota) |
| 8 | rent-lastmonth | How much rent did I pay last month? | ✅ | ✅ | ✅ | The amount matches the ground truth exactly. |
| 9 | topcat-lastmonth | Which category did I spend the most on last month? | ✅ | ✅ | ✅ | All figures provided by the assistant match the ground truth exactly. |
| 10 | transport-monthname | How much did I spend on transport in June? | ✅ | ✅ | ✅ | The amount matches the ground truth exactly. |
| 11 | compare-food | Compare my food spending this month vs last month | ✅ | ✅ | ✅ | The figures match the ground truth exactly, and the difference and percentage are correct  |
| 12 | txncount-lastmonth | How many transactions did I make last month? | ✅ | ✅ | ✅ | The transaction count and total spending match the ground truth. |
| 13 | shopping-vs-groceries | Did I spend more on shopping or groceries last month? | ✅ | ✅ | ✅ | The assistant's figures and conclusion match the ground truth exactly. |

## Transcript

### 1. groceries-last30
**Q:** How much did I spend on groceries in the last 30 days?
**Ground truth:** Groceries spend in 2026-06-06..2026-07-06 = ₹16665
**Agent:** In the last 30 days (2026-06-06 to 2026-07-06), you spent ₹16,665 on Groceries across 12 transactions.
**Judge (none):** correct=null faithful=null — judge unavailable (LLM quota)

### 2. total-lastmonth
**Q:** How much did I spend in total last month?
**Ground truth:** Total expenses in 2026-06-01..2026-06-30 = ₹90820
**Agent:** You spent ₹90,820 in last month.
**Judge (gemma-4-26b-a4b-it):** correct=true faithful=true — The total expense amount matches the ground truth exactly.

### 3. income-lastmonth
**Q:** What was my income last month?
**Ground truth:** Income in 2026-06-01..2026-06-30 = ₹98000
**Agent:** Your income in last month was ₹98,000.
**Judge (gemma-4-26b-a4b-it):** correct=true faithful=true — The income figure matches the ground truth exactly.

### 4. savings-lastmonth
**Q:** How much did I save last month?
**Ground truth:** Net savings in 2026-06-01..2026-06-30 = income ₹98000 - expenses ₹90820 = ₹7180
**Agent:** In last month you earned ₹98,000 and spent ₹90,820, saving ₹7,180.
**Judge (none):** correct=null faithful=null — judge unavailable (LLM quota)

### 5. biggest-lastmonth
**Q:** What was my single biggest expense last month?
**Ground truth:** Largest expenses in 2026-06-01..2026-06-30: #1 ₹18990 at Croma (Shopping); #2 ₹18000 at Rent - Landlord (Rent); #3 ₹3960 at Croma (Shopping). The single biggest is #1.
**Agent:** Your biggest expenses in last month:
1. ₹18,990 — Croma (Shopping, 2026-06-28)
2. ₹18,000 — Rent - Landlord (Rent, 2026-06-03)
3. ₹3,960 — Croma (Shopping, 2026-06-25)
4. ₹3,237 — Flipkart (Shopping, 2026-06-15)
5. ₹2,564 — Blinkit (Groceries, 2026-06-10)
**Judge (none):** correct=null faithful=null — judge unavailable (LLM quota)

### 6. swiggy-count-last30
**Q:** How many Swiggy orders did I make in the last 30 days?
**Ground truth:** Swiggy orders in 2026-06-06..2026-07-06 = 1 totalling ₹486
**Agent:** Swiggy Order: 1 transactions in the last 30 days, totalling ₹486 (avg ₹486).
**Judge (gemma-4-26b-a4b-it):** correct=true faithful=true — The count and total amount match the ground truth exactly.

### 7. netflix-90d
**Q:** How much have I spent on Netflix in the last 90 days?
**Ground truth:** Netflix spend in 2026-04-07..2026-07-06 = ₹1298 across 2 charges
**Agent:** Netflix: 2 transactions in the last 90 days, totalling ₹1,298 (avg ₹649).
**Judge (none):** correct=null faithful=null — judge unavailable (LLM quota)

### 8. rent-lastmonth
**Q:** How much rent did I pay last month?
**Ground truth:** Rent in 2026-06-01..2026-06-30 = ₹18000
**Agent:** You spent ₹18,000 on Rent in last month.
**Judge (gemma-4-26b-a4b-it):** correct=true faithful=true — The amount matches the ground truth exactly.

### 9. topcat-lastmonth
**Q:** Which category did I spend the most on last month?
**Ground truth:** Top category in 2026-06-01..2026-06-30 = Shopping at ₹28586
**Agent:** Your top spending category in last month was Shopping at ₹28,586, followed by Rent ₹18,000, Groceries ₹17,330. Total spent: ₹90,820.
**Judge (gemma-4-26b-a4b-it):** correct=true faithful=true — All figures provided by the assistant match the ground truth exactly.

### 10. transport-monthname
**Q:** How much did I spend on transport in June?
**Ground truth:** Transport spend in June (2026-06-01..2026-06-30) = ₹3983
**Agent:** You spent ₹3,983 on Transport in June.
**Judge (gemma-4-26b-a4b-it):** correct=true faithful=true — The amount matches the ground truth exactly.

### 11. compare-food
**Q:** Compare my food spending this month vs last month
**Ground truth:** Food & Dining: this month (2026-07-01..2026-07-06) = ₹1486; last month (2026-06-01..2026-06-30) = ₹6894
**Agent:** Food & Dining: ₹1,486 this month vs ₹6,894 last month — ₹5,408 less (-78%).
**Judge (gemma-4-31b-it):** correct=true faithful=true — The figures match the ground truth exactly, and the difference and percentage are correct derivations.

### 12. txncount-lastmonth
**Q:** How many transactions did I make last month?
**Ground truth:** Transactions in 2026-06-01..2026-06-30 = 66
**Agent:** You made 66 transactions in last month, spending ₹90,820 in total.
**Judge (gemma-4-31b-it):** correct=true faithful=true — The transaction count and total spending match the ground truth.

### 13. shopping-vs-groceries
**Q:** Did I spend more on shopping or groceries last month?
**Ground truth:** Last month (2026-06-01..2026-06-30): Shopping = ₹28586, Groceries = ₹17330. Higher: Shopping
**Agent:** In last month: Shopping ₹28,586 vs Groceries ₹17,330 — you spent more on Shopping.
**Judge (gemma-4-26b-a4b-it):** correct=true faithful=true — The assistant's figures and conclusion match the ground truth exactly.

