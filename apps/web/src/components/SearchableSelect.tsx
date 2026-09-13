import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  label?: string;
  error?: string;
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** When set, search is driven by the parent (e.g. server-side); local filtering is skipped. */
  onSearchChange?: (query: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
}

const isActionOption = (option: SearchableSelectOption) =>
  option.value.startsWith('__add_') || option.label.startsWith('+');

export function SearchableSelect({
  label,
  error,
  options,
  value,
  onChange,
  onSearchChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  disabled = false,
  className,
  emptyMessage = 'No results found',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const onSearchChangeRef = useRef(onSearchChange);
  const inputId = useId();
  const serverDriven = Boolean(onSearchChange);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  const selectableOptions = useMemo(
    () => options.filter((option) => option.value && !isActionOption(option)),
    [options],
  );

  const actionOptions = useMemo(() => options.filter(isActionOption), [options]);

  const filteredOptions = useMemo(() => {
    if (serverDriven) {
      return [...selectableOptions, ...actionOptions];
    }

    const normalized = query.trim().toLowerCase();
    const matched = normalized
      ? selectableOptions.filter((option) => option.label.toLowerCase().includes(normalized))
      : selectableOptions;

    return [...matched, ...actionOptions];
  }, [actionOptions, query, selectableOptions, serverDriven]);

  const updateQuery = (next: string) => {
    setQuery(next);
    onSearchChangeRef.current?.(next);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        onSearchChangeRef.current?.('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    updateQuery('');
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    handleClose();
  };

  const handleClear = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    onChange('');
    updateQuery('');
  };

  return (
    <div ref={containerRef} className={cn('relative space-y-1.5', className)}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}

      <div className="relative">
        <button
          type="button"
          id={inputId}
          disabled={disabled}
          onClick={handleOpen}
          className={cn(
            'input-field flex w-full items-center justify-between gap-2 text-left',
            error && 'border-red-400',
            disabled && 'cursor-not-allowed opacity-60',
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={cn('truncate', !selectedOption && 'text-gray-400')}>
            {selectedOption?.label ?? placeholder}
          </span>

          <div className="flex items-center gap-1">
            {value && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleClear(event);
                  }
                }}
                className="rounded p-0.5 hover:bg-gray-100"
                aria-label="Clear selection"
              >
                <X className="h-4 w-4 text-gray-400" />
              </span>
            )}
            <ChevronDown
              className={cn('h-4 w-4 shrink-0 text-gray-400 transition', open && 'rotate-180')}
            />
          </div>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="border-b border-gray-100 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') handleClose();
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
              {filteredOptions.length === actionOptions.length && query.trim() ? (
                <li className="px-3 py-2 text-sm text-gray-500">{emptyMessage}</li>
              ) : (
                filteredOptions.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      onClick={() => handleSelect(option.value)}
                      className={cn(
                        'w-full px-3 py-2 text-left text-sm hover:bg-brand-50',
                        option.value === value && 'bg-brand-50 font-medium text-brand-700',
                        isActionOption(option) && 'border-t border-gray-100 font-medium text-brand-600',
                      )}
                    >
                      {option.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
