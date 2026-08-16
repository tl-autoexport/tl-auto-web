export type CatalogStats = {
  visible: number;
  bySource: {
    encar: number;
  };
  byBrand: Record<string, number>;
  byModel: Record<string, number>;
  stale: number;
};

type EvaluateCatalogHealthInput = {
  before: CatalogStats;
  after: CatalogStats;
  sourceSeen: {
    encar: number;
  };
  minimumSourceSeen: {
    encar: number;
  };
  minimumCatalogBySource: {
    encar: number;
  };
  minimumTotal: number;
  brandMinimums: Record<string, number>;
  modelMinimums: Record<string, number>;
  maxVisibleDropPercent: number;
  cleanupSkipped: boolean;
};

export function evaluateCatalogHealth(input: EvaluateCatalogHealthInput) {
  const reasons: string[] = [];
  const visibleDrop =
    input.before.visible > input.after.visible
      ? input.before.visible - input.after.visible
      : 0;
  const visibleDropPercent =
    input.before.visible > 0
      ? (visibleDrop / input.before.visible) * 100
      : 0;

  for (const source of ["encar"] as const) {
    if (input.sourceSeen[source] < input.minimumSourceSeen[source]) {
      reasons.push(
        `${source}: fetched ${input.sourceSeen[source]}, minimum ${input.minimumSourceSeen[source]}`,
      );
    }
    if (
      input.after.bySource[source] < input.minimumCatalogBySource[source]
    ) {
      reasons.push(
        `${source}: catalog has ${input.after.bySource[source]}, minimum ${input.minimumCatalogBySource[source]}`,
      );
    }
  }

  if (input.after.visible < input.minimumTotal) {
    reasons.push(
      `catalog: visible ${input.after.visible}, minimum ${input.minimumTotal}`,
    );
  }

  for (const [brand, minimum] of Object.entries(input.brandMinimums)) {
    if ((input.after.byBrand[brand] ?? 0) < minimum) {
      reasons.push(
        `${brand}: catalog has ${input.after.byBrand[brand] ?? 0}, minimum ${minimum}`,
      );
    }
  }

  for (const [identity, minimum] of Object.entries(input.modelMinimums)) {
    if ((input.after.byModel[identity] ?? 0) < minimum) {
      reasons.push(
        `${identity}: catalog has ${input.after.byModel[identity] ?? 0}, minimum ${minimum}`,
      );
    }
  }

  if (visibleDropPercent > input.maxVisibleDropPercent) {
    reasons.push(
      `catalog: visible count dropped ${visibleDropPercent.toFixed(1)}%, maximum ${input.maxVisibleDropPercent}%`,
    );
  }

  if (input.cleanupSkipped) {
    reasons.push("catalog: stale cleanup was blocked by the safety floor");
  }

  return {
    complete: reasons.length === 0,
    reasons,
    visibleDrop,
    visibleDropPercent,
  };
}
