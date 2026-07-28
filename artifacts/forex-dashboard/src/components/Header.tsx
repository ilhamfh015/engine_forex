import { useState, useEffect } from 'react';
import { RefreshCw, Clock, BarChart2 } from 'lucide-react';
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
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <header className="border-b border-card-border bg-card/50 backdrop-blur-sm sticky top-0 z-50" data-testid="header">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <BarChart2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground" data-testid="text-title">
                Forex Market Structure Analyzer
              </h1>
              <p className="text-xs text-muted-foreground">Real-time trading intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Select value={selectedPair} onValueChange={onPairChange}>
              <SelectTrigger className="w-[140px] bg-card border-card-border" data-testid="select-pair">
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

            <div className="flex items-center gap-2 text-sm text-muted-foreground border-l border-card-border pl-4">
              <Clock className="h-4 w-4" />
              <span data-testid="text-last-update">{formatTime(lastUpdate)}</span>
              <span className="text-xs opacity-60">({countdown}s)</span>
            </div>

            <Button
              onClick={onRefresh}
              disabled={isRefreshing}
              size="sm"
              variant="outline"
              className="gap-2"
              data-testid="button-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
