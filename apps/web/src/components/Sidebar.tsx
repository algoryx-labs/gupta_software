import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, CircleHelp, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/Logo';
import { DeveloperCredit } from '@/components/DeveloperCredit';
import { useAuth } from '@/auth/AuthContext';
import { getFilteredNav, type NavItem } from '@/routes/navConfig';

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function NavLinkItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const location = useLocation();
  const hasChildren = item.children && item.children.length > 0;
  const [expanded, setExpanded] = useState(
    hasChildren && item.children!.some((c) => location.pathname.startsWith(c.path)),
  );

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition',
            location.pathname.startsWith(item.path)
              ? 'text-brand-600'
              : 'text-gray-600 hover:bg-brand-50',
          )}
        >
          <span className="flex items-center gap-3">
            <item.icon className="h-5 w-5" />
            {item.label}
          </span>
          <ChevronDown className={cn('h-4 w-4 transition', expanded && 'rotate-180')} />
        </button>
        {expanded && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
            {item.children!.map((child) => (
              <NavLink
                key={child.path}
                to={child.path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
                    isActive
                      ? 'bg-brand-gradient font-medium text-white shadow-soft'
                      : 'text-gray-600 hover:bg-brand-50',
                  )
                }
              >
                <child.icon className="h-4 w-4" />
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
          isActive
            ? 'bg-brand-gradient text-white shadow-soft'
            : 'text-gray-600 hover:bg-brand-50',
        )
      }
    >
      <item.icon className="h-5 w-5" />
      {item.label}
    </NavLink>
  );
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { can } = useAuth();
  const navItems = getFilteredNav(can);

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
        <Logo size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">Inventory & Purchase</p>
        </div>
        <button className="ml-auto md:hidden" onClick={onMobileClose}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => (
          <NavLinkItem key={item.path} item={item} onNavigate={onMobileClose} />
        ))}
      </nav>
      <div className="shrink-0 space-y-2 border-t border-border px-3 py-3">
        <a
          href="https://algoryx.io/support"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onMobileClose}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-brand-50"
        >
          <CircleHelp className="h-5 w-5" />
          Help & Support
        </a>
        <DeveloperCredit compact />
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden h-full w-64 shrink-0 overflow-hidden border-r border-border bg-surface md:block">
        {content}
      </aside>
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onMobileClose} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-surface shadow-xl md:hidden">
            {content}
          </aside>
        </>
      )}
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="rounded-lg p-2 hover:bg-brand-50 md:hidden" onClick={onClick}>
      <Menu className="h-5 w-5" />
    </button>
  );
}
