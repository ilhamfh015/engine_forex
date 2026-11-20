function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted/60 ${className}`} />;
}

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background" data-testid="loading-fullpage">
      <div className="border-b border-border/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Block className="h-9 w-9 rounded-xl" />
            <div className="space-y-2">
              <Block className="h-3 w-40" />
              <Block className="h-2 w-28" />
            </div>
          </div>
          <Block className="h-9 w-24" />
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border/40 lg:grid-cols-4">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className="space-y-2 bg-card/90 p-4">
              <Block className="h-2 w-20" />
              <Block className="h-6 w-28" />
              <Block className="h-2 w-24" />
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <div className="panel panel-pad space-y-4">
              <Block className="h-3 w-28" />
              <Block className="h-6 w-48" />
              <div className="grid gap-4 lg:grid-cols-2">
                <Block className="h-44 w-full" />
                <Block className="h-44 w-full" />
              </div>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <Block className="h-52 w-full rounded-xl" />
              <Block className="h-52 w-full rounded-xl" />
            </div>
          </div>
          <div className="space-y-6">
            <Block className="h-96 w-full rounded-xl" />
            <Block className="h-48 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
