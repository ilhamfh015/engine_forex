import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  fullPage?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function LoadingSpinner({ fullPage = false, size = 'md' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  };

  const spinner = (
    <Loader2 className={`${sizeClasses[size]} animate-spin text-primary`} data-testid="loading-spinner" aria-hidden="true" />
  );

  if (fullPage) {
    return (
      <div
        className="dashboard-shell flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background"
        data-testid="loading-fullpage"
        role="status"
        aria-live="polite"
      >
        {spinner}
        <span className="text-sm text-muted-foreground">Memuat analisis pasar…</span>
      </div>
    );
  }

  return spinner;
}
