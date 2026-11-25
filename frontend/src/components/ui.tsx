import { useEffect, useId, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

export type IconName =
  | 'archive'
  | 'alert'
  | 'box'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'close'
  | 'download'
  | 'edit'
  | 'external'
  | 'fit'
  | 'folder'
  | 'grid'
  | 'help'
  | 'info'
  | 'key'
  | 'layers'
  | 'library'
  | 'logout'
  | 'moon'
  | 'pause'
  | 'play'
  | 'plus'
  | 'refresh'
  | 'ruler'
  | 'search'
  | 'shield'
  | 'spinner'
  | 'star'
  | 'sun'
  | 'target'
  | 'trash'
  | 'upload'
  | 'user';

const iconPaths: Record<IconName, ReactNode> = {
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>,
  alert: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
  box: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  fit: <><path d="M8 3H3v5" /><path d="M16 3h5v5" /><path d="M21 16v5h-5" /><path d="M3 16v5h5" /><rect x="8" y="8" width="8" height="8" rx="1" /></>,
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.2-8.2" /><path d="m17 6 2 2" /><path d="m14 9 2 2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
  library: <><path d="M4 4h5v16H4z" /><path d="M11 4h4v16h-4z" /><path d="m17.5 5 2.5.7-3.1 13.6-2.4-.7Z" /></>,
  logout: <><path d="M10 4H5v16h5" /><path d="m14 8 4 4-4 4" /><path d="M9 12h9" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
  play: <path d="m8 5 11 7-11 7Z" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  ruler: <><path d="M4 15 15 4l5 5L9 20Z" /><path d="m8 10 2 2" /><path d="m11 7 2 2" /><path d="m14 4 2 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  shield: <><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6Z" /><path d="m9 12 2 2 4-4" /></>,
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.9 4.9l1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m4.9 19.1 1.4-1.4" /><path d="m17.7 6.3 1.4-1.4" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="M2 12h3" /><path d="M19 12h3" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" /><path d="M10 11v5" /><path d="M14 11v5" /></>,
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 20h16" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
};

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {iconPaths[name]}
    </svg>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'quiet' | 'onDark';
type ButtonSize = 'xs' | 'sm' | 'md' | 'icon';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-ink bg-accent text-ink hover:bg-[#21e887]',
  secondary: 'border-ink bg-canvas text-ink hover:bg-surface',
  danger: 'border-terracotta bg-terracotta text-paper hover:bg-[#d94949]',
  ghost: 'border-transparent bg-transparent text-ink hover:bg-surface',
  quiet: 'border-ink/60 bg-surface/70 text-ink hover:bg-surface',
  onDark: 'border-paper/40 bg-transparent text-paper hover:bg-paper/10',
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'h-6 w-6 gap-1 text-[10px]',
  sm: 'h-8 gap-1.5 px-2.5 text-[10px]',
  md: 'h-10 gap-2 px-3.5 text-[11px]',
  icon: 'h-9 w-9 justify-center',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className = ''): string {
  const iconOnly = size === 'icon' || size === 'xs' ? 'p-0' : '';
  return `inline-flex items-center justify-center rounded-control border font-mono font-bold uppercase tracking-[0.1em] transition-colors duration-100 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 ${variantClasses[variant]} ${sizeClasses[size]} ${iconOnly} ${className}`;
}

interface SharedButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  asLink?: boolean;
  to?: string;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, SharedButtonProps {}

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement>, SharedButtonProps {
  asLink: true;
  to: string;
}

export function Button(props: ButtonProps | LinkButtonProps) {
  const { variant = 'secondary', size = 'md', icon, loading = false, children, className = '' } = props;
  const classes = buttonClass(variant, size, className);
  const content = <>{loading ? <Icon name="spinner" className="animate-spin" /> : icon ? <Icon name={icon} /> : null}{children}</>;
  if ('asLink' in props && props.asLink && props.to) {
    const linkProps = props as LinkButtonProps;
    const { asLink: _asLink, to, variant: _v, size: _s, icon: _i, loading: _l, className: _c, children: _ch, ...rest } = linkProps;
    return <Link to={to} className={classes} {...rest}>{content}</Link>;
  }
  const buttonProps = props as ButtonProps;
  const { asLink: _asLink, to: _to, variant: _v, size: _s, icon: _i, loading: _l, className: _c, children: _ch, disabled, type = 'button', ...rest } = buttonProps;
  return <button type={type} disabled={disabled || loading} className={classes} {...rest}>{content}</button>;
}

export function IconButton({ label, icon, variant = 'ghost', size = 'icon', ...rest }: Omit<ButtonProps, 'icon' | 'children' | 'asLink' | 'to'> & { label: string; icon: IconName }) {
  return <Button aria-label={label} title={label} variant={variant} size={size} icon={icon} {...rest} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-surface border border-ink bg-surface p-5 ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: string; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink pb-5">
      <div className="min-w-0 flex-1">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="font-mono text-2xl font-bold uppercase tracking-[0.08em] text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl font-sans text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-dash pb-2">
      <h2 className="label flex items-center gap-2 text-ink"><span className="h-2 w-2 shrink-0 bg-accent" />{title}</h2>
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label mb-1.5 block text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block font-sans text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass = 'w-full rounded-control border border-ink bg-paper px-3 py-2 font-mono text-[13px] text-ink placeholder:text-muted/70 transition-colors hover:border-ink focus:border-accent focus:outline-none focus:ring-0';

export function Badge({ children, tone = 'ink', className = '' }: { children: ReactNode; tone?: 'ink' | 'accent' | 'danger' | 'warning' | 'lavender'; className?: string }) {
  const tones = {
    ink: 'border-ink bg-ink text-paper',
    accent: 'border-ink bg-accent text-ink',
    danger: 'border-terracotta bg-terracotta text-paper',
    warning: 'border-ink bg-amber text-ink',
    lavender: 'border-lavender bg-lavender/20 text-ink',
  } as const;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 label ${tones[tone]} ${className}`}>{children}</span>;
}

export function Metric({ label, value, hint, tone = 'default', className = '' }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'accent' | 'danger'; className?: string }) {
  const accent = tone === 'accent' ? 'border-l-accent' : tone === 'danger' ? 'border-l-terracotta' : 'border-l-ink';
  return (
    <div className={`rounded-control border border-ink border-l-4 bg-paper px-3 py-2 ${accent} ${className}`}>
      <span className="label block text-muted">{label}</span>
      <span className="metric-value mt-1 block text-ink">{value}</span>
      {hint && <span className="mt-1 block font-sans text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

export function SegmentedProgress({ value, max, label, className = '' }: { value: number; max: number; label?: string; className?: string }) {
  const segments = 12;
  const filled = max > 0 ? Math.min(segments, Math.round((value / max) * segments)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={`flex gap-1 ${className}`}
    >
      {Array.from({ length: segments }, (_, index) => (
        <span key={index} className={`h-3 flex-1 border border-ink ${index < filled ? 'bg-accent' : 'bg-canvas'}`} />
      ))}
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  badge?: ReactNode;
}

export function Tabs({ items, value, onChange, className = '' }: { items: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div role="tablist" className={`flex gap-4 overflow-x-auto border-b border-ink ${className}`}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`inline-flex h-10 shrink-0 items-center gap-2 border-b-[3px] px-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-control border border-terracotta bg-terracotta/10 px-3 py-2.5 font-sans text-sm text-ink [&_svg]:text-terracotta">
      <Icon name="alert" className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

export function NoticeBanner({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-control border border-ink border-l-4 border-l-accent bg-paper px-3 py-2.5 font-sans text-sm text-ink [&_svg]:text-accent">
      <Icon name="info" className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ icon = 'box', title, description, action }: { icon?: IconName; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-surface border border-dashed border-dash bg-canvas px-6 py-12 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-control border border-ink bg-accent/20 text-ink"><Icon name={icon} size={24} /></span>
      <h2 className="font-mono text-sm font-bold uppercase tracking-[0.1em] text-ink">{title}</h2>
      {description && <p className="mt-2 max-w-md font-sans text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-surface border border-ink bg-surface" aria-hidden="true">
      <div className="h-36 animate-pulse bg-dash/25" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded-control bg-dash/25" />
        <div className="h-3 w-1/2 animate-pulse rounded-control bg-dash/25" />
        <div className="h-3 w-1/3 animate-pulse rounded-control bg-dash/25" />
      </div>
    </div>
  );
}

interface ModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  icon?: IconName;
  tone?: 'default' | 'danger';
  closeLabel?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

/** Modal de la app: portal, foco atrapado, Escape, clic fuera y bloqueo de scroll. */
export function Modal({ open, title, description, icon, tone = 'default', closeLabel = 'Cerrar', children, footer, onClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = (): HTMLElement[] => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    const frame = requestAnimationFrame(() => {
      const items = focusables();
      (items.find((item) => item.dataset.autofocus === 'true') ?? items[0])?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-2 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="flex min-h-[70vh] max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-surface border-2 border-ink bg-canvas"
      >
        <div className="flex items-start gap-3 border-b-2 border-ink bg-terminal p-5 text-paper">
          {icon && (
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-ink ${tone === 'danger' ? 'bg-terracotta text-paper' : 'bg-accent text-ink'}`}>
              <Icon name={icon} size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-mono text-lg font-bold uppercase tracking-[0.1em]">{title}</h2>
            {description && <p id={descriptionId} className="mt-2 max-w-2xl font-sans text-sm text-paper/70">{description}</p>}
          </div>
          <IconButton label={closeLabel} icon="close" variant="onDark" size="sm" onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t-2 border-ink bg-surface p-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  icon?: IconName;
  tone?: 'default' | 'danger';
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  loading?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({ tone = 'danger', icon, loading = false, error, onConfirm, ...rest }: ConfirmModalProps) {
  return (
    <Modal
      {...rest}
      tone={tone}
      icon={icon ?? (tone === 'danger' ? 'alert' : 'check')}
      footer={
        <>
          <Button data-autofocus onClick={rest.onClose} disabled={loading}>{rest.cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} icon={tone === 'danger' ? 'trash' : 'check'} loading={loading} onClick={onConfirm}>
            {rest.confirmLabel}
          </Button>
        </>
      }
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </Modal>
  );
}

interface PromptModalProps {
  open: boolean;
  title: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onClose: () => void;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  type?: 'text' | 'password';
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
  loading?: boolean;
}

export function PromptModal({ open, title, label, value, onChange, onSubmit, onClose, confirmLabel, cancelLabel, closeLabel, placeholder, hint, error, type = 'text', minLength, maxLength, autoComplete, loading = false }: PromptModalProps) {
  const formId = useId();
  return (
    <Modal
      open={open}
      title={title}
      icon="edit"
      closeLabel={closeLabel}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button form={formId} type="submit" variant="primary" icon="check" loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(value); }} className="space-y-4">
        <Field label={label} hint={hint}>
          <input
            data-autofocus
            type={type}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            minLength={minLength}
            maxLength={maxLength}
            autoComplete={autoComplete}
            className={`${inputClass} text-base`}
          />
        </Field>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </form>
    </Modal>
  );
}
