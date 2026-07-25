export function AppLoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background">
      <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-[22px] bg-primary shadow-lg shadow-primary/20">
        <span className="text-4xl font-bold text-primary-foreground">৳</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm font-medium text-muted-foreground">Finance OS</p>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}
