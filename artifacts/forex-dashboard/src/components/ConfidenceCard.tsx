import { motion } from 'framer-motion';
import { CheckCircle, XCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { ChecklistItem } from '@workspace/api-client-react';

interface ConfidenceCardProps {
  confidence: number;
  confidenceLevel: 'High' | 'Medium' | 'Low';
  checklist: ChecklistItem[];
  index: number;
}

export function ConfidenceCard({ confidence, confidenceLevel, checklist, index }: ConfidenceCardProps) {
  const getConfidenceColor = () => {
    if (confidence >= 71) return 'text-primary';
    if (confidence >= 41) return 'text-yellow-500';
    return 'text-destructive';
  };

  const getBgColor = () => {
    if (confidence >= 71) return 'bg-primary/5';
    if (confidence >= 41) return 'bg-yellow-500/5';
    return 'bg-destructive/5';
  };

  const getBorderColor = () => {
    if (confidence >= 71) return 'border-primary/20';
    if (confidence >= 41) return 'border-yellow-500/20';
    return 'border-destructive/20';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`relative overflow-hidden rounded-xl border ${getBorderColor()} ${getBgColor()} backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-lg`}
      data-testid="card-confidence"
    >
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-1 text-foreground">Entry Confluence Score</h3>
        <p className="mb-5 text-xs text-muted-foreground">Skor heuristik 0–100, bukan probabilitas menang.</p>
        
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-48 h-48 mb-4">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="96"
                cy="96"
                r="88"
                stroke="currentColor"
                strokeWidth="8"
                fill="none"
                className="text-muted/20"
              />
              <motion.circle
                cx="96"
                cy="96"
                r="88"
                stroke="currentColor"
                strokeWidth="8"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 88}`}
                className={getConfidenceColor()}
                initial={{ strokeDashoffset: 2 * Math.PI * 88 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 88 * (1 - confidence / 100) }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-5xl font-bold ${getConfidenceColor()}`} data-testid="text-confidence-percent">
                {confidence}/100
              </span>
            </div>
          </div>
          <div className={`px-4 py-2 rounded-full ${getBgColor()} border ${getBorderColor()}`}>
            <span className={`text-sm font-semibold ${getConfidenceColor()}`} data-testid="text-confidence-level">
              {confidenceLevel} confluence
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground mb-4">Entry Analysis</p>
          {checklist.map((item, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.5 + idx * 0.1 }}
              className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-card-border"
              data-testid={`checklist-item-${idx}`}
            >
              {item.passed ? (
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" data-testid={`icon-check-${idx}`} />
              ) : (
                <XCircle className="h-5 w-5 text-destructive flex-shrink-0" data-testid={`icon-x-${idx}`} />
              )}
              <div className="flex-1">
                <p className={`text-sm font-medium ${item.passed ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {item.label}
                </p>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {Math.round(item.weight * 100)}%
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
