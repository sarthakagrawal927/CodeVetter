import { GatewayReviewFile, ReviewFinding, ReviewScore } from '../../shared-types/src';
import { severityWeight } from './findings';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateScore(files: GatewayReviewFile[], findings: ReviewFinding[]): ReviewScore {
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const fileCount = files.length;
  const changedLines = additions + deletions;

  const totalPenalty = findings.reduce((sum, finding) => sum + severityWeight(finding.severity), 0);
  const quality = clamp(100 - totalPenalty, 0, 100);

  const highCount = findings.filter(finding => finding.severity === 'high').length;
  const criticalCount = findings.filter(finding => finding.severity === 'critical').length;

  const churnFactor = Math.min(50, Math.round(changedLines / 20));
  const highSeverityFactor = Math.min(40, highCount * 12 + criticalCount * 18);
  const touchedFileFactor = Math.min(20, Math.max(0, fileCount - 3) * 2);
  const risk = clamp(churnFactor + highSeverityFactor + touchedFileFactor, 0, 100);

  const hasTests = files.some(file => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./i.test(file.path));
  const hasDocs = files.some(file => /(^|\/)(docs?)\/|readme\.md$/i.test(file.path));
  const signalBoost =
    (hasTests ? 12 : 0) +
    (hasDocs ? 8 : 0) +
    Math.min(15, Math.round(Math.max(0, additions - deletions) / 50));

  const churnNoisePenalty = Math.min(35, Math.round(changedLines / 70));
  const value = clamp(40 + signalBoost - churnNoisePenalty, 0, 100);

  const composite = Math.round(0.5 * quality + 0.3 * (100 - risk) + 0.2 * value);

  return {
    quality,
    risk,
    value,
    composite
  };
}
