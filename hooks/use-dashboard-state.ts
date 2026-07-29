"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseWindowKey, type WindowKey } from "@/lib/api-types";
import {
  hasAnyFilter,
  parseFilters,
  serialiseFilters,
  type MetricFilters,
} from "@/lib/db/filters";

/**
 * Dashboard state, kept in the URL rather than in React state.
 *
 * The point is shareability: "the RAG spike on GPT-4o over 7 days" should be a
 * link you can paste to a colleague, and a reload should not silently drop you
 * back to the default view. It also means the server can parse exactly the same
 * query string the client is showing, so there is one representation of the
 * filters instead of two that can drift.
 */

export type FilterDimension = keyof MetricFilters;

export interface DashboardState {
  windowKey: WindowKey;
  filters: MetricFilters;
  /** Query string for the API, including the window. */
  queryString: string;
  hasFilters: boolean;
}

export interface DashboardActions {
  setWindow: (key: WindowKey) => void;
  toggleFilter: (dimension: FilterDimension, value: string) => void;
  setFilter: (dimension: FilterDimension, values: string[]) => void;
  clearFilters: () => void;
}

export function useDashboardState(): DashboardState & DashboardActions {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const windowKey = parseWindowKey(searchParams.get("window"));
  // Re-parsing rather than trusting the URL text keeps client and server
  // agreeing on what a filter set means, including which values are valid.
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams(serialiseFilters(filters));
    params.set("window", windowKey);
    return params.toString();
  }, [filters, windowKey]);

  const push = useCallback(
    (next: { windowKey?: WindowKey; filters?: MetricFilters }) => {
      const params = new URLSearchParams(
        serialiseFilters(next.filters ?? filters),
      );
      const w = next.windowKey ?? windowKey;
      // The default window is implicit, so the common case stays a clean URL.
      if (w !== "24h") params.set("window", w);

      const query = params.toString();
      // `replace`, not `push`: dragging a filter chip should not bury the back
      // button under thirty history entries.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [filters, windowKey, pathname, router],
  );

  const setWindow = useCallback(
    (key: WindowKey) => push({ windowKey: key }),
    [push],
  );

  const setFilter = useCallback(
    (dimension: FilterDimension, values: string[]) =>
      push({ filters: { ...filters, [dimension]: values } as MetricFilters }),
    [filters, push],
  );

  const toggleFilter = useCallback(
    (dimension: FilterDimension, value: string) => {
      const current: string[] = filters[dimension];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      setFilter(dimension, next);
    },
    [filters, setFilter],
  );

  const clearFilters = useCallback(
    () => push({ filters: { models: [], endpoints: [], statuses: [] } }),
    [push],
  );

  return {
    windowKey,
    filters,
    queryString,
    hasFilters: hasAnyFilter(filters),
    setWindow,
    toggleFilter,
    setFilter,
    clearFilters,
  };
}
