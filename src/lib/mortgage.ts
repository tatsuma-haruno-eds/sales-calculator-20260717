export type Household =
  | "単身"
  | "夫婦"
  | "夫婦+子1人"
  | "夫婦+子2人"
  | "夫婦+子3人以上"
  | "その他";

export type Tenure = "1年未満" | "1-3年" | "3-5年" | "5-10年" | "10年以上";

export type MortgageInput = {
  income: number;
  age: number;
  household: Household;
  tenure: Tenure;
  price: number;
  downPayment: number;
  years: number;
  desiredMonthly: number | "";
  carDebt: number;
  otherDebt: number;
  cardSpend: number;
  memo: string;
};

export type LoanScenario = {
  name: string;
  rate: number;
  rateRange: string;
  monthlyPayment: number;
  totalPayment: number;
  interest: number;
  fees: number;
  repaymentRatio: number;
  incomeMultiple: number;
  judgement: "無理なく返済可能" | "やや厳しい" | "要再検討";
  judgementLevel: number;
  schedule: AnnualPayment[];
};

export type AnnualPayment = {
  year: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
  cumulativeInterest: number;
};

export type Diagnosis = {
  principal: number;
  existingMonthly: number;
  fees: { registration: number; loanFee: number; insurance: number; stamp: number; total: number };
  borrowing: { name: string; amount: number; propertyPrice: number }[];
  scenarios: LoanScenario[];
  completionAge: number;
  warnings: string[];
};

const yen = (man: number) => Math.round(man * 10_000);

export function monthlyPayment(principal: number, annualRate: number, months: number) {
  if (principal <= 0 || months <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return Math.round(principal / months);
  const factor = (1 + monthlyRate) ** months;
  return Math.round((principal * monthlyRate * factor) / (factor - 1));
}

function borrowingLimit(income: number, existingMonthly: number, ratio: number, years: number) {
  const allowedMonthly = Math.max(0, (income * ratio) / 12 - existingMonthly);
  const monthlyRate = 0.035 / 12;
  const months = years * 12;
  const factor = (1 + monthlyRate) ** months;
  const repaymentCapacity = (allowedMonthly * (factor - 1)) / (monthlyRate * factor);
  return Math.min(income * (ratio === 0.25 ? 5 : ratio === 0.3 ? 6 : 8), repaymentCapacity, income * 8);
}

function buildSchedule(principal: number, years: number, rate: number, resetRate?: number) {
  const monthly = years * 12;
  let balance = principal;
  let cumulativeInterest = 0;
  let totalPayment = 0;
  const schedule: AnnualPayment[] = [];
  let currentRate = rate;
  let installment = monthlyPayment(balance, currentRate, monthly);

  for (let month = 1; month <= monthly; month += 1) {
    if (resetRate !== undefined && month === 121) {
      currentRate = resetRate;
      installment = monthlyPayment(balance, currentRate, monthly - 120);
    }
    const interest = Math.floor((balance * currentRate) / 100 / 12);
    const payment = month === monthly ? balance + interest : Math.min(installment, balance + interest);
    const principalPaid = payment - interest;
    balance = Math.max(0, balance - principalPaid);
    cumulativeInterest += interest;
    totalPayment += payment;
    const year = Math.ceil(month / 12);
    let row = schedule[year - 1];
    if (!row) {
      row = { year, payment: 0, principal: 0, interest: 0, balance: 0, cumulativeInterest: 0 };
      schedule.push(row);
    }
    row.payment += payment;
    row.principal += principalPaid;
    row.interest += interest;
    row.balance = balance;
    row.cumulativeInterest = cumulativeInterest;
  }

  return { schedule, totalPayment, interest: cumulativeInterest };
}

export function diagnose(input: MortgageInput): Diagnosis {
  const principal = yen(Math.max(0, input.price - input.downPayment));
  const existingMonthly = yen(input.carDebt / 60 + input.otherDebt / 60 + input.cardSpend * 0.15);
  const incomeYen = yen(input.income);
  const term = input.years * 12;
  const fees = {
    registration: Math.round(yen(input.price) * 0.005),
    loanFee: Math.round(principal * 0.022),
    insurance: yen(50),
    stamp: Math.round(yen(input.price) * 0.003),
    total: 0,
  };
  fees.total = fees.registration + fees.loanFee + fees.insurance + fees.stamp;

  const borrowing = [
    { name: "保守", ratio: 0.25 },
    { name: "標準", ratio: 0.3 },
    { name: "積極", ratio: 0.35 },
  ].map(({ name, ratio }) => {
    const amount = Math.round(borrowingLimit(incomeYen, existingMonthly, ratio, input.years));
    return { name, amount, propertyPrice: amount + yen(input.downPayment) };
  });

  const scenarios = [
    { name: "変動金利", rate: 0.7, range: "0.4〜1.0%" },
    { name: "固定10年", rate: 1.3, range: "1.0〜1.5%", resetRate: 1.5 },
    { name: "全期間固定", rate: 1.8, range: "1.5〜2.0%" },
  ].map(({ name, rate, range, resetRate }) => {
    const result = buildSchedule(principal, input.years, rate, resetRate);
    const monthly = monthlyPayment(principal, rate, term);
    const repaymentRatio = incomeYen > 0
      ? ((monthly + existingMonthly) * 12) / incomeYen * 100
      : 0;
    const incomeMultiple = incomeYen > 0 ? principal / incomeYen : 0;
    const ratioLevel = repaymentRatio <= 25 ? 0 : repaymentRatio <= 30 ? 1 : 2;
    const multipleLevel = incomeMultiple <= 6 ? 0 : incomeMultiple <= 7 ? 1 : 2;
    const judgementLevel = Math.max(ratioLevel, multipleLevel);

    return {
      name,
      rate,
      rateRange: range,
      monthlyPayment: monthly,
      totalPayment: result.totalPayment,
      interest: result.interest,
      fees: fees.total,
      repaymentRatio,
      incomeMultiple,
      judgement: (["無理なく返済可能", "やや厳しい", "要再検討"] as const)[judgementLevel],
      judgementLevel,
      schedule: result.schedule,
    };
  });

  const warnings = [];
  if (input.age + input.years > 80) warnings.push(`完済時年齢は${input.age + input.years}歳です（80歳超）。`);
  if (input.tenure === "1年未満") warnings.push("勤続年数が1年未満のため、金融機関への事前確認をおすすめします。");

  return { principal, existingMonthly, fees, borrowing, scenarios, completionAge: input.age + input.years, warnings };
}

export function defaultInput(): MortgageInput {
  return {
    income: 400,
    age: 35,
    household: "夫婦",
    tenure: "3-5年",
    price: 3500,
    downPayment: 350,
    years: 35,
    desiredMonthly: "",
    carDebt: 0,
    otherDebt: 0,
    cardSpend: 0,
    memo: "",
  };
}

export function validateInput(input: MortgageInput) {
  const errors: Partial<Record<keyof MortgageInput, string>> = {};
  const range = (key: keyof MortgageInput, value: number, min: number, max: number, label: string) => {
    if (!Number.isFinite(value) || value < min || value > max) errors[key] = `${label}は${min.toLocaleString()}〜${max.toLocaleString()}の範囲で入力してください。`;
  };
  range("income", input.income, 100, 3000, "年収");
  range("age", input.age, 20, 70, "年齢");
  range("price", input.price, 1000, 10000, "物件価格");
  if (Number.isFinite(input.price) && input.price % 100 !== 0) errors.price = "物件価格は100万円単位で入力してください。";
  range("downPayment", input.downPayment, 0, input.price * 0.5, "頭金");
  if (![10, 15, 20, 25, 30, 35].includes(input.years)) errors.years = "返済期間を選択してください。";
  range("carDebt", input.carDebt, 0, 1000, "車のローン残高");
  range("otherDebt", input.otherDebt, 0, 1000, "その他借入残高");
  range("cardSpend", input.cardSpend, 0, 100, "カード月間利用額");
  if (Number.isFinite(input.cardSpend) && Math.round(input.cardSpend * 10) !== input.cardSpend * 10) {
    errors.cardSpend = "カード月間利用額は0.1万円単位で入力してください。";
  }
  if (input.desiredMonthly !== "") range("desiredMonthly", input.desiredMonthly, 5, 50, "希望月額");
  if (input.memo.length > 20) errors.memo = "メモは20文字以内で入力してください。";
  return errors;
}
