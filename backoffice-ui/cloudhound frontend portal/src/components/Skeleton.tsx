interface SkeletonProps {
  className?: string;
  isLightMode?: boolean;
}

export function Skeleton({ className = '', isLightMode = false }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded ${isLightMode ? 'bg-slate-200' : 'bg-[#1e2736]'} ${className}`}
      aria-hidden="true"
    />
  );
}

interface MetricCardSkeletonProps {
  isLightMode?: boolean;
}

export function MetricCardSkeleton({ isLightMode = false }: MetricCardSkeletonProps) {
  return (
    <div
      className={`rounded-lg border p-6 ${isLightMode ? 'border-slate-300 bg-white' : 'border-[#364258] bg-[#171e2a]'}`}
    >
      <Skeleton className="h-3 w-20 mb-4" isLightMode={isLightMode} />
      <Skeleton className="h-8 w-24" isLightMode={isLightMode} />
    </div>
  );
}
