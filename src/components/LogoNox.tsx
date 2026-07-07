import React from 'react';
import { cn } from '@/lib/utils';

interface LogoNoxProps {
  variant?: 'claro' | 'escuro';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function LogoNox({ variant = 'claro', size = 'md', className = '' }: LogoNoxProps) {
  const corNox = variant === 'escuro' ? 'text-white' : 'text-neutral-900';
  const corFianca = variant === 'escuro' ? '#FFFFFF' : '#0A0A0A';
  
  const tamanhos = {
    sm: { simbolo: 'h-9', nox: 'text-xl', fianca: 'text-[8px]' },
    md: { simbolo: 'h-12', nox: 'text-[28px]', fianca: 'text-[10px]' },
    lg: { simbolo: 'h-14', nox: 'text-[34px]', fianca: 'text-[11px]' },
    xl: { simbolo: 'h-16', nox: 'text-4xl', fianca: 'text-xs' },
  };
  
  const t = tamanhos[size];
  
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <img 
        src="/brand/simbolo-nox.svg" 
        alt="Símbolo NOX" 
        className={cn(t.simbolo, "w-auto shrink-0")} 
      />
      
      <div className="flex flex-col items-center leading-none overflow-visible">
        <span className={cn("font-bold tracking-tight whitespace-nowrap", t.nox, corNox)}>
          NOX
        </span>
        <span 
          className={cn("font-bold tracking-[0.2em] -mt-0.5 whitespace-nowrap pl-[0.2em]", t.fianca)}
          style={{ color: corFianca }}
        >
          FIANÇA
        </span>
      </div>
    </div>
  );
}
