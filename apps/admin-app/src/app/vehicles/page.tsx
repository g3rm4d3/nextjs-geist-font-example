'use client';

import type { AdminVehicleSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminVehicles } from '@/lib/apiClient';

/** Section 14's "Vehicles" — read-only across every driver's vehicle. */
export default function VehiclesPage() {
  const { accessToken } = useAdminAuth();
  const [vehicles, setVehicles] = useState<AdminVehicleSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await listAdminVehicles(token);
        if (!cancelled) setVehicles(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load vehicles.',
          );
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <AdminShell
      title="Vehicles"
      subtitle={`${vehicles.length} vehicle(s)`}
      errorMessage={errorMessage}
    >
      {vehicles.length === 0 ? (
        <p className="text-sm text-slate-500">No vehicles on file.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Make/model</th>
                <th className="px-4 py-3">Year</th>
                <th className="px-4 py-3">Color</th>
                <th className="px-4 py-3">Plate</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link
                      href={`/drivers/${vehicle.driverId}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {vehicle.driverName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {vehicle.make} {vehicle.model}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{vehicle.year}</td>
                  <td className="px-4 py-3 text-slate-600">{vehicle.color}</td>
                  <td className="px-4 py-3 text-slate-600">{vehicle.licensePlate}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        vehicle.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {vehicle.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
