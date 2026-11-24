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
  | 'folder'
  | 'grid'
  | 'info'
  | 'key'
  | 'layers'
  | 'library'
  | 'logout'
  | 'plus'
  | 'refresh'
  | 'ruler'
  | 'search'
  | 'shield'
  | 'spinner'
  | 'star'
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
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.2-8.2" /><path d="m17 6 2 2" /><path d="m14 9 2 2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
  library: <><path d="M4 4h5v16H4z" /><path d="M11 4h4v16h-4z" /><path d="m17.5 5 2.5.7-3.1 13.6-2.4-.7Z" /></>,
  logout: <><path d="M10 4H5v16h5" /><path d="m14 8 4 4-4 4" /><path d="M9 12h9" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  ruler: <><path d="M4 15 15 4l5 5L9 20Z" /><path d="m8 10 2 2" /><path d="m11 7 2 2" /><path d="m14 4 2 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  shield: <><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6Z" /><path d="m9 12 2 2 4-4" /></>,
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />,
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

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'quiet';
type ButtonSize = 'sm' | 'md' | 'icon';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-accent bg-accent text-white hover:brightness-110',
  secondary: 'border-slate-700 bg-slate-800/60 text-slate-100 hover:border-slate-600 hover:bg-slate-800',
  danger: 'border-red-900/70 bg-red-950/40 text-red-300 hover:border-red-700 hover:bg-red-950/70',
  ghost: 'border-transparent bg-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white',
  quiet: 'border-slate-800 bg-surface text-slate-300 hover:border-slate-600 hover:text-white',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-10 gap-2 px-3.5 text-sm',
  icon: 'h-9 w-9 justify-center',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className = ''): string {
  const iconOnly = size === 'icon' ? 'p-0' : '';
  return `inline-flex items-center justify-center rounded-lg border font-medium transition-[background-color,border-color,color,filter,transform] duration-100 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 ${variantClasses[variant]} ${sizeClasses[size]} ${iconOnly} ${className}`;
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
  return <section className={`rounded-2xl border border-slate-800 bg-panel p-5 ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: string; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
      <div className="min-w-0 flex-1">
        {back}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1.5 block font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass = 'w-full rounded-lg border border-slate-700 bg-surface px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 hover:border-slate-600 focus:border-accent';

export function ErrorBanner({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2.5 text-sm text-red-300">
      <Icon name="alert" className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

export function NoticeBanner({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm text-slate-100">
      <Icon name="info" className="mt-0.5 text-accent" />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ icon = 'box', title, description, action }: { icon?: IconName; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-700 bg-panel/50 px-6 py-12 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Icon name={icon} size={24} /></span>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-panel" aria-hidden="true">
      <div className="h-36 animate-pulse bg-slate-800" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded-lg bg-slate-800" />
        <div className="h-3 w-1/2 animate-pulse rounded-lg bg-slate-800" />
        <div className="h-3 w-1/3 animate-pulse rounded-lg bg-slate-800" />
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-panel p-5 shadow-2xl shadow-black/50"
      >
        <div className="mb-4 flex items-start gap-3">
          {icon && (
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone === 'danger' ? 'bg-red-950/50 text-red-300' : 'bg-accent/15 text-accent'}`}>
              <Icon name={icon} size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-white">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
          <IconButton label={closeLabel} icon="close" size="sm" onClick={onClose} className="-mr-1 -mt-1" />
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">{footer}</div>}
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
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(value); }} className="space-y-3">
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
            className={inputClass}
          />
        </Field>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </form>
    </Modal>
  );
}
