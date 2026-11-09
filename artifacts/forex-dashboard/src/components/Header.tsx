import { Clock, RefreshCw, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface HeaderProps {
  selectedPair: string;
  onPairChange: (pair: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdate: string | null;
}

const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD'];

export function Header({ selectedPair, onPairChange, onRefresh, isRefreshing, lastUpdate }: HeaderProps) {
  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Belum diperbarui';
    return `${new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(isoString))} WIB`;
  };

  return (
    <header className="sticky top-0 z-50 border-b border-card-border bg-background/85 backdrop-blur-xl" data-testid="header">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground sm:text-lg" data-testid="text-title">
              Forex Structure
            </h1>
            <p className="text-xs text-muted-foreground">Analisis pasar multi-timeframe</p>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:gap-3">
          <Select value={selectedPair} onValueChange={onPairChange}>
            <SelectTrigger
              className="h-10 w-full border-card-border bg-card/80 sm:w-36"
              aria-label="Pilih pasangan instrumen"
              data-testid="select-pair"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAIRS.map((pair) => (
                <SelectItem key={pair} value={pair} data-testid={`option-pair-${pair}`}>
                  {pair}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="order-3 col-span-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground sm:order-none sm:col-span-1 sm:border-l sm:border-card-border sm:pl-3">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate" data-testid="text-last-update">
              Diperbarui {formatTime(lastUpdate)}
            </span>
          </div>

          <Button
            onClick={onRefresh}
            disabled={isRefreshing}
            size="sm"
            variant="outline"
            className="h-10 gap-2 border-card-border px-3"
            data-testid="button-refresh"
            aria-label={isRefreshing ? 'Memperbarui analisis' : 'Perbarui analisis'}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Perbarui</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
