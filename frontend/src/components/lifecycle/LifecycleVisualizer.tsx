// frontend/src/components/lifecycle/LifecycleVisualizer.tsx
"use client"

import React from 'react'
import { Check, Circle, AlertCircle, Rocket, Wrench, Archive, DraftingCompass, Code, FlaskConical } from 'lucide-react'

export type LifecycleStage =
  | 'identify'
  | 'design'
  | 'develop'
  | 'test'
  | 'deploy'
  | 'maintain'
  | 'deprecated'

interface LifecycleStatus {
  current_stage: LifecycleStage
  stage_changed_at: string
  possible_next_stages: LifecycleStage[]
  next_stage_gates: Record<string, Record<string, boolean>>
  progress_percent: number
  is_deployed: boolean
  is_deprecated: boolean
}

interface LifecycleVisualizerProps {
  status: LifecycleStatus
  detectionId: string
  onAdvanceStage?: (targetStage: LifecycleStage) => Promise<void>
}

const STAGE_CONFIG: Record<LifecycleStage, {
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
  description: string
}> = {
  identify: {
    label: 'Identify',
    icon: Circle,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    description: 'Document threat intelligence and requirements'
  },
  design: {
    label: 'Design',
    icon: DraftingCompass,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    description: 'Create detection hypothesis and design document'
  },
  develop: {
    label: 'Develop',
    icon: Code,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    description: 'Build and iterate on detection rule'
  },
  test: {
    label: 'Test',
    icon: FlaskConical,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    description: 'Validate detection with atomic tests'
  },
  deploy: {
    label: 'Deploy',
    icon: Rocket,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    description: 'Push detection to production SIEM'
  },
  maintain: {
    label: 'Maintain',
    icon: Wrench,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    description: 'Monitor health and tune in production'
  },
  deprecated: {
    label: 'Deprecated',
    icon: Archive,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    description: 'Retired from production'
  }
}

const STAGE_ORDER: LifecycleStage[] = [
  'identify',
  'design',
  'develop',
  'test',
  'deploy',
  'maintain'
]

export function LifecycleVisualizer({ status, detectionId, onAdvanceStage }: LifecycleVisualizerProps) {
  const currentIndex = STAGE_ORDER.indexOf(status.current_stage)

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <div className="relative">
        <div className="flex justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Detection Lifecycle Progress</span>
          <span className="text-sm font-medium text-gray-700">{status.progress_percent}%</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 transition-all duration-500"
            style={{ width: `${status.progress_percent}%` }}
          />
        </div>
      </div>

      {/* Stage Timeline */}
      <div className="relative">
        {/* Connecting Line */}
        <div className="absolute top-8 left-0 right-0 h-0.5 bg-gray-200"
             style={{ left: '2rem', right: '2rem' }}
        />

        {/* Stages */}
        <div className="flex justify-between relative">
          {STAGE_ORDER.map((stage, index) => {
            const config = STAGE_CONFIG[stage]
            const Icon = config.icon
            const isCurrent = stage === status.current_stage
            const isPast = index < currentIndex
            const isFuture = index > currentIndex

            return (
              <div key={stage} className="flex flex-col items-center flex-1">
                {/* Icon Circle */}
                <div
                  className={`
                    w-16 h-16 rounded-full flex items-center justify-center z-10 border-4
                    transition-all duration-300
                    ${isCurrent
                      ? `${config.bgColor} ${config.color} border-current shadow-lg scale-110`
                      : isPast
                        ? 'bg-green-100 text-green-600 border-green-600'
                        : 'bg-gray-100 text-gray-400 border-gray-300'
                    }
                  `}
                >
                  {isPast ? (
                    <Check className="w-8 h-8" />
                  ) : (
                    <Icon className="w-8 h-8" />
                  )}
                </div>

                {/* Label */}
                <div className="mt-3 text-center">
                  <div className={`
                    text-sm font-semibold
                    ${isCurrent ? config.color : isPast ? 'text-green-700' : 'text-gray-500'}
                  `}>
                    {config.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 max-w-[100px]">
                    {config.description}
                  </div>
                </div>

                {/* Current Stage Badge */}
                {isCurrent && (
                  <div className="mt-2">
                    <span className={`
                      inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                      ${config.bgColor} ${config.color}
                    `}>
                      Current
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Current Stage Details */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Current Stage: {STAGE_CONFIG[status.current_stage].label}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {STAGE_CONFIG[status.current_stage].description}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Last updated: {new Date(status.stage_changed_at).toLocaleDateString()}
            </p>
          </div>

          {/* Status Badges */}
          <div className="flex gap-2">
            {status.is_deployed && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                🚀 Deployed
              </span>
            )}
            {status.is_deprecated && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                📦 Deprecated
              </span>
            )}
          </div>
        </div>

        {/* Next Steps */}
        {status.possible_next_stages.length > 0 && !status.is_deprecated && (
          <div className="mt-6 space-y-4">
            <h4 className="text-sm font-semibold text-gray-900">Ready to Advance?</h4>

            {status.possible_next_stages.map(nextStage => {
              const gates = status.next_stage_gates[nextStage] || {}
              const allGatesPassed = Object.values(gates).every(v => v === true)
              const failedGates = Object.entries(gates).filter(([_, passed]) => !passed)

              return (
                <div key={nextStage} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`
                        w-10 h-10 rounded-full flex items-center justify-center
                        ${STAGE_CONFIG[nextStage].bgColor} ${STAGE_CONFIG[nextStage].color}
                      `}>
                        {React.createElement(STAGE_CONFIG[nextStage].icon, { className: 'w-5 h-5' })}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          Advance to {STAGE_CONFIG[nextStage].label}
                        </div>
                        <div className="text-xs text-gray-500">
                          {STAGE_CONFIG[nextStage].description}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onAdvanceStage?.(nextStage)}
                      disabled={!allGatesPassed}
                      className={`
                        px-4 py-2 rounded-lg text-sm font-medium transition-all
                        ${allGatesPassed
                          ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }
                      `}
                    >
                      {allGatesPassed ? 'Advance →' : 'Not Ready'}
                    </button>
                  </div>

                  {/* Gates Checklist */}
                  {Object.keys(gates).length > 0 && (
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-medium text-gray-700">Requirements:</div>
                      {Object.entries(gates).map(([gateName, passed]) => (
                        <div key={gateName} className="flex items-center gap-2">
                          {passed ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-600" />
                          )}
                          <span className={`text-xs ${passed ? 'text-gray-700' : 'text-red-600'}`}>
                            {formatGateName(gateName)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Failed Gates Alert */}
                  {!allGatesPassed && failedGates.length > 0 && (
                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-800">
                          <strong>Blocked:</strong> Complete {failedGates.length} requirement
                          {failedGates.length > 1 ? 's' : ''} before advancing.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Deprecated State */}
        {status.is_deprecated && (
          <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-2">
              <Archive className="w-5 h-5 text-gray-600" />
              <span className="text-sm font-medium text-gray-900">
                This detection has been deprecated
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              This is a terminal state. Detection is no longer active in production.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper function to format gate names
function formatGateName(gateName: string): string {
  return gateName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Compact version for detection list view
export function LifecycleBadge({ stage }: { stage: LifecycleStage }) {
  const config = STAGE_CONFIG[stage]
  const Icon = config.icon

  return (
    <span className={`
      inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
      ${config.bgColor} ${config.color}
    `}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
    </span>
  )
}

// Progress indicator for dashboard cards
export function LifecycleProgress({ progressPercent }: { progressPercent: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-slate-300">
        <span className="uppercase tracking-[0.2em] text-slate-500">Lifecycle Progress</span>
        <span className="font-semibold text-slate-100">{progressPercent}%</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-sky-500 via-blue-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  )
}
