import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Workflow, LayoutDashboard, ExternalLink, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

const NAV_ITEMS = [
  { to: '/', label: 'Workflows', icon: Workflow },
  { to: '/boards', label: 'Boards', icon: LayoutDashboard },
];

export function Header() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-semibold text-foreground hover:text-primary transition-colors">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
              <Workflow className="h-4 w-4 text-primary" />
            </div>
            <span className="hidden sm:inline" style={{ fontFamily: "'Geist Pixel', monospace" }}>consensus board</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
              return (
                <Link key={item.to} to={item.to}>
                  <Button
                    variant={active ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('gap-2', active && 'bg-secondary')}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <Link to="/settings">
            <Button
              variant={location.pathname === '/settings' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn('gap-2', location.pathname === '/settings' ? 'bg-secondary' : 'text-muted-foreground hover:text-foreground')}
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </Link>
          <a
            href="https://github.com/consensus-tools"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Open Source</span>
            </Button>
          </a>
        </div>
      </div>
    </header>
  );
}
