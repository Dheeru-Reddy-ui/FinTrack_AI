/**
 * FinTrack AI — eval cases for the RAG agent.
 *
 * Each case has a natural-language question and a `truth` function that
 * computes the expected answer from the SAME deterministic SQL RPCs the agent
 * uses — but with harness-fixed date ranges, so the ground truth is known and
 * independent of the agent's planner. `checks` are numeric assertions
 * (tolerance absorbs ±1-day boundary drift); `textChecks` are substrings the
 * answer must contain (case-insensitive).
 */

const money = (v) => ({ value: Math.round(v), tol: Math.max(50, Math.round(v * 0.02)) });
const exact = (v) => ({ value: Math.round(v), tol: 0 });

export const CASES = [
  {
    id: 'groceries-last30',
    range: 'last30',
    question: 'How much did I spend on groceries in the last 30 days?',
    truth: async (t, r) => {
      const v = await t.catTotal(r.last30, 'Groceries');
      return { facts: `Groceries spend in ${r.last30.from}..${r.last30.to} = ₹${v}`, checks: [money(v)] };
    },
  },
  {
    id: 'total-lastmonth',
    range: 'lastMonth',
    question: 'How much did I spend in total last month?',
    truth: async (t, r) => {
      const s = await t.summary(r.lastMonth);
      return { facts: `Total expenses in ${r.lastMonth.from}..${r.lastMonth.to} = ₹${s.expense}`, checks: [money(s.expense)] };
    },
  },
  {
    id: 'income-lastmonth',
    range: 'lastMonth',
    question: 'What was my income last month?',
    truth: async (t, r) => {
      const s = await t.summary(r.lastMonth);
      return { facts: `Income in ${r.lastMonth.from}..${r.lastMonth.to} = ₹${s.income}`, checks: [money(s.income)] };
    },
  },
  {
    id: 'savings-lastmonth',
    range: 'lastMonth',
    question: 'How much did I save last month?',
    truth: async (t, r) => {
      const s = await t.summary(r.lastMonth);
      return { facts: `Net savings in ${r.lastMonth.from}..${r.lastMonth.to} = income ₹${s.income} - expenses ₹${s.expense} = ₹${s.net}`, checks: [money(s.net)] };
    },
  },
  {
    id: 'biggest-lastmonth',
    range: 'lastMonth',
    question: 'What was my single biggest expense last month?',
    truth: async (t, r) => {
      // Ground truth includes the top 3 so the judge can verify any extra
      // context the agent volunteers (it often lists runners-up).
      const top = await t.top(r.lastMonth, 3);
      return {
        facts: `Largest expenses in ${r.lastMonth.from}..${r.lastMonth.to}: ${top.map((x, i) => `#${i + 1} ₹${x.amount} at ${x.merchant} (${x.category})`).join('; ')}. The single biggest is #1.`,
        checks: [money(Number(top[0].amount))],
        textChecks: [top[0].merchant],
      };
    },
  },
  {
    id: 'swiggy-count-last30',
    range: 'last30',
    question: 'How many Swiggy orders did I make in the last 30 days?',
    truth: async (t, r) => {
      const m = await t.merchant('Swiggy', r.last30);
      return { facts: `Swiggy orders in ${r.last30.from}..${r.last30.to} = ${m.txn_count} totalling ₹${m.total}`, checks: [exact(Number(m.txn_count))] };
    },
  },
  {
    id: 'netflix-90d',
    range: 'last90',
    question: 'How much have I spent on Netflix in the last 90 days?',
    truth: async (t, r) => {
      const m = await t.merchant('Netflix', r.last90);
      return { facts: `Netflix spend in ${r.last90.from}..${r.last90.to} = ₹${m.total} across ${m.txn_count} charges`, checks: [money(Number(m.total))] };
    },
  },
  {
    id: 'rent-lastmonth',
    range: 'lastMonth',
    question: 'How much rent did I pay last month?',
    truth: async (t, r) => {
      const v = await t.catTotal(r.lastMonth, 'Rent');
      return { facts: `Rent in ${r.lastMonth.from}..${r.lastMonth.to} = ₹${v}`, checks: [money(v)] };
    },
  },
  {
    id: 'topcat-lastmonth',
    range: 'lastMonth',
    question: 'Which category did I spend the most on last month?',
    truth: async (t, r) => {
      const cats = await t.byCategory(r.lastMonth);
      return {
        facts: `Top category in ${r.lastMonth.from}..${r.lastMonth.to} = ${cats[0].category} at ₹${cats[0].total}`,
        checks: [],
        textChecks: [cats[0].category],
      };
    },
  },
  {
    id: 'transport-monthname',
    range: 'june',
    question: 'How much did I spend on transport in June?',
    truth: async (t, r) => {
      const v = await t.catTotal(r.june, 'Transport');
      return { facts: `Transport spend in June (${r.june.from}..${r.june.to}) = ₹${v}`, checks: [money(v)] };
    },
  },
  {
    id: 'compare-food',
    range: 'lastMonth',
    question: 'Compare my food spending this month vs last month',
    truth: async (t, r) => {
      const a = await t.catTotal(r.thisMonth, 'Food & Dining');
      const b = await t.catTotal(r.lastMonth, 'Food & Dining');
      return {
        facts: `Food & Dining: this month (${r.thisMonth.from}..${r.thisMonth.to}) = ₹${a}; last month (${r.lastMonth.from}..${r.lastMonth.to}) = ₹${b}`,
        checks: [money(a), money(b)],
      };
    },
  },
  {
    id: 'txncount-lastmonth',
    range: 'lastMonth',
    question: 'How many transactions did I make last month?',
    truth: async (t, r) => {
      const s = await t.summary(r.lastMonth);
      return { facts: `Transactions in ${r.lastMonth.from}..${r.lastMonth.to} = ${s.txn_count}`, checks: [exact(Number(s.txn_count))] };
    },
  },
  {
    id: 'shopping-vs-groceries',
    range: 'lastMonth',
    question: 'Did I spend more on shopping or groceries last month?',
    truth: async (t, r) => {
      const shop = await t.catTotal(r.lastMonth, 'Shopping');
      const groc = await t.catTotal(r.lastMonth, 'Groceries');
      const winner = shop > groc ? 'Shopping' : 'Groceries';
      return {
        facts: `Last month (${r.lastMonth.from}..${r.lastMonth.to}): Shopping = ₹${shop}, Groceries = ₹${groc}. Higher: ${winner}`,
        checks: [],
        textChecks: [winner],
      };
    },
  },
];
