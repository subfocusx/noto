// Server health probe.
import type { HealthResponse } from '../types';
import { request } from './http';

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}
