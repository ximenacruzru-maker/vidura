// Estimated take-home pay for a paycheck in San Jose, California (no city income tax there). An estimate only: it
// assumes no pre-tax deductions (401(k), health premiums), no extra W-4 withholding, and the standard deduction.
//   Regular pay (salary, hours) is taxed as if every payday were the same: the check × 24, taxed for the year, ÷ 24.
//   Bonuses and commission are supplemental wages: withheld at the flat 22% federal and 10.23% California rates.
//   Social Security 6.2% (to the 2026 wage base), Medicare 1.45%, California SDI 1.3%.
// Federal: 2026 brackets and standard deduction (IRS Rev. Proc. 2025-32). California: 2025 brackets, standard
// deduction and exemption credit (the latest published by the FTB).

export type FilingStatus = 'single' | 'married'

type Brackets = [number, number][] // [upper limit, rate]
const FED: Record<FilingStatus, { std: number; brackets: Brackets }> = {
  single: { std: 16100, brackets: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]] },
  married: { std: 32200, brackets: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]] },
}
const CA: Record<FilingStatus, { std: number; credit: number; brackets: Brackets }> = {
  single: { std: 5706, credit: 153, brackets: [[11079, 0.01], [26264, 0.02], [41452, 0.04], [57542, 0.06], [72724, 0.08], [371479, 0.093], [445771, 0.103], [742953, 0.113], [Infinity, 0.123]] },
  married: { std: 11412, credit: 306, brackets: [[22158, 0.01], [52528, 0.02], [82904, 0.04], [115084, 0.06], [145448, 0.08], [742958, 0.093], [891542, 0.103], [1485906, 0.113], [Infinity, 0.123]] },
}
const SS_RATE = 0.062, SS_BASE = 184500, MEDICARE = 0.0145, CA_SDI = 0.013
const FED_SUPPLEMENTAL = 0.22, CA_SUPPLEMENTAL = 0.1023
const PAYDAYS = 24

function bracketTax(income: number, brackets: Brackets) {
  let tax = 0, lower = 0
  for (const [upper, rate] of brackets) {
    if (income <= lower) break
    tax += (Math.min(income, upper) - lower) * rate
    lower = upper
  }
  return tax
}
const r2 = (n: number) => Math.round(n * 100) / 100

/** One paycheck's estimated deductions and take-home: regular pay (salary or hours) and supplemental pay (bonuses,
 *  commission) on that check. */
export function takeHome(regular: number, supplemental: number, status: FilingStatus) {
  const annual = regular * PAYDAYS
  const fed = r2(bracketTax(Math.max(0, annual - FED[status].std), FED[status].brackets) / PAYDAYS + supplemental * FED_SUPPLEMENTAL)
  const caAnnual = Math.max(0, bracketTax(Math.max(0, annual - CA[status].std), CA[status].brackets) - CA[status].credit)
  const ca = r2(caAnnual / PAYDAYS + supplemental * CA_SUPPLEMENTAL)
  const gross = regular + supplemental
  // Social Security stops at the year's wage base: above it, only the base's share of each check is taxed
  const ss = r2((annual >= SS_BASE ? Math.min(gross, SS_BASE / PAYDAYS) : gross) * SS_RATE)
  const medicare = r2(gross * MEDICARE)
  const sdi = r2(gross * CA_SDI)
  const lines = [
    { label: 'Federal income tax', amount: fed },
    { label: 'California income tax', amount: ca },
    { label: 'Social Security (6.2%)', amount: ss },
    { label: 'Medicare (1.45%)', amount: medicare },
    { label: 'CA SDI (1.3%)', amount: sdi },
  ]
  const deductions = r2(lines.reduce((s, l) => s + l.amount, 0))
  return { gross: r2(gross), lines, deductions, net: r2(gross - deductions) }
}
