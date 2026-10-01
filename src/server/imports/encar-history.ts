/** Public Encar record: preserve source counters, events and ownership changes. */
export function mapEncarOpenHistory(value: Record<string, unknown>) {
  if (value.openData !== true) return null;
  const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v as Record<string, unknown>[] : [];
  const events = list(value.accidents).map(event => ({
    accidentDate: event.date, accidentType: event.type, repairCost: event.insuranceBenefit,
    partCost: event.partCost, laborCost: event.laborCost, paintingCost: event.paintingCost,
  }));
  const summary = {
    available: true,
    accident_count: value.accidentCnt ?? events.length,
    my_car_accident_count: value.myAccidentCnt ?? null,
    other_accident_count: value.otherAccidentCnt ?? null,
    my_car_accident_cost: value.myAccidentCost ?? null,
    other_car_accident_cost: value.otherAccidentCost ?? null,
    insurance_payout_count: events.length,
    insurance_payout_total_krw: events.reduce((sum, e) => sum + Number(e.repairCost ?? 0), 0),
    owner_changed_count: value.ownerChangeCnt ?? null,
    loan_count: value.loan ?? null,
    total_loss_count: value.totalLossCnt ?? null,
    theft_count: value.robberCnt ?? null,
    flood_total_loss_count: value.floodTotalLossCnt ?? null,
    flood_part_loss_count: value.floodPartLossCnt ?? null,
  };
  return { summary, items: events, raw_payload: {
    ...summary, accidentHistoryResponse: events,
    ownerHistoryResponse: Array.isArray(value.ownerChanges) ? value.ownerChanges.map(date => ({ acquisitionDate: date })) : [],
    nonInsurancePeriodResponse: [1,2,3,4,5].flatMap(i => {
      const period = value[`notJoinDate${i}`];
      if (typeof period !== 'string' || !period) return [];
      const [startDate, endDate] = period.split('~');
      return [{ startDate, endDate }];
    }),
  } };
}
