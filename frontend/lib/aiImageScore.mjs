export function aiScorePercent(value) {
  if (value == null || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export function aiScoreWidth(value) {
  return `${aiScorePercent(value) ?? 0}%`;
}
