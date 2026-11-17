import React from 'react';

export interface GlassProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Glass({ className = '', children, ...rest }: GlassProps) {
  return (
    <div className={`axnna-surface ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'glass' | 'filled';
  destructive?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = 'glass',
  destructive = false,
  icon,
  className = '',
  type = 'button',
  children,
  ...rest
}: UiButtonProps) {
  const variantClass = variant === 'filled' ? 'axnna-btn--filled' : 'axnna-btn--glass';
  const dangerClass = destructive ? 'axnna-btn--destructive' : '';
  return (
    <button
      type={type}
      className={`axnna-btn ${variantClass} ${dangerClass} ${className}`.trim()}
      {...rest}
    >
      {icon && <span className="axnna-btn-icon">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

export interface UiInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onValueChange?: (value: string) => void;
  icon?: React.ReactNode;
}

export function Input({ onValueChange, icon, className = '', ...rest }: UiInputProps) {
  return (
    <div className="axnna-input-wrap">
      {icon && <span className="axnna-input-icon">{icon}</span>}
      <input
        className={`axnna-input ${icon ? 'has-icon' : ''} ${className}`.trim()}
        onChange={(e) => onValueChange?.(e.target.value)}
        {...rest}
      />
    </div>
  );
}

export interface UiSwitchProps {
  checked: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({ checked, disabled, 'aria-label': ariaLabel, onCheckedChange }: UiSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`axnna-switch ${checked ? 'is-checked' : ''}`.trim()}
    >
      <span className="axnna-switch-thumb" />
    </button>
  );
}

export interface UiSegmentedItem {
  value: string;
  label: string;
}

export interface UiSegmentedControlProps {
  value: string;
  onValueChange: (value: string) => void;
  items: UiSegmentedItem[];
}

export function SegmentedControl({ value, onValueChange, items }: UiSegmentedControlProps) {
  return (
    <div className="admin-tabs" role="tablist" aria-label="Console Sections">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`admin-tab-pill ${active ? 'is-active' : ''}`.trim()}
            onClick={() => onValueChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
