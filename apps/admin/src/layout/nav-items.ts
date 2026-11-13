import {
  Boxes,
  LayoutDashboard,
  Package,
  ScrollText,
  ShoppingBag,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StaffRole } from '../auth/staff-api';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  // Shown only to this role. The API refuses everyone else either way.
  role?: StaffRole;
  // Not built yet: the page says when it arrives.
  arrives?: string;
  summary: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Overview',
    icon: LayoutDashboard,
    summary: 'Where the console starts.',
  },
  {
    to: '/catalog',
    label: 'Catalog',
    icon: Package,
    summary: 'Categories, products, pack sizes and images.',
  },
  {
    to: '/stock',
    label: 'Stock',
    icon: Boxes,
    arrives: 'Part 12D',
    summary: 'Batches received, expiry dates and what is in stock.',
  },
  {
    to: '/orders',
    label: 'Orders',
    icon: ShoppingBag,
    arrives: 'a later part',
    summary: 'Packing, shipping, delivery, cancellations and refunds.',
  },
  {
    to: '/admins',
    label: 'Admins',
    icon: Users,
    role: 'SUPER_USER',
    arrives: 'a later part',
    summary: 'Inviting Admins and managing their accounts.',
  },
  {
    to: '/audit-log',
    label: 'Audit log',
    icon: ScrollText,
    role: 'SUPER_USER',
    arrives: 'a later part',
    summary: 'Who did what, and when.',
  },
];

export function navItemsFor(role: StaffRole): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.role || item.role === role);
}
