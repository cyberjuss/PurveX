"use client";

import { useState, useEffect, useRef } from "react";
import { X, Sparkles, Shield, Activity, Target, Settings, Eye, Zap, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import Shepherd from "shepherd.js";
import { cn } from "@/lib/utils";

type InteractiveGuideProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function InteractiveGuide({ isOpen, onClose }: InteractiveGuideProps) {
  const pathname = usePathname();
  const router = useRouter();
  const tourInstanceRef = useRef<InstanceType<typeof Shepherd.Tour> | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  // Cleanup tour on unmount or close
  useEffect(() => {
    if (!isOpen) {
      if (tourInstanceRef.current) {
        tourInstanceRef.current.cancel();
        tourInstanceRef.current = null;
      }
      setShowWelcome(true);
      setIsStarting(false);
    }
  }, [isOpen]);

  // Helper function to wait for element and navigate if needed
  const waitForElement = (selector: string, route?: string, timeout = 3000): Promise<void> => {
    return new Promise((resolve) => {
      // Navigate first if needed
      if (route && pathname !== route) {
        router.push(route);
        // Wait for navigation to complete and page to render
        setTimeout(() => {
          let attempts = 0;
          const maxAttempts = 30; // Increased attempts
          const checkInterval = 150; // Slightly longer interval

          const checkElement = () => {
            attempts++;
            const element = document.querySelector(selector) as HTMLElement;
            // Also check if page is loaded
            const isPageReady = document.readyState === 'complete' || document.readyState === 'interactive';
            
            if (element || (attempts >= maxAttempts && isPageReady)) {
              resolve();
              return;
            }
            setTimeout(checkElement, checkInterval);
          };

          // Start checking after a brief delay to allow navigation
          setTimeout(checkElement, 200);
        }, 500); // Increased initial delay
      } else {
        // Already on the right page, just check for element
        let attempts = 0;
        const maxAttempts = 15;
        const checkInterval = 100;

        const checkElement = () => {
          attempts++;
          const element = document.querySelector(selector) as HTMLElement;
          if (element || attempts >= maxAttempts) {
            resolve();
            return;
          }
          setTimeout(checkElement, checkInterval);
        };

        // Small delay to ensure DOM is ready
        setTimeout(checkElement, 100);
      }
    });
  };

  // Enterprise-grade tour steps covering key features
  const createTour = () => {
    // Cancel any existing tour
    if (tourInstanceRef.current) {
      tourInstanceRef.current.cancel();
    }

    const tour = new Shepherd.Tour({
      useModalOverlay: true,
      defaultStepOptions: {
        classes: "purvex-shepherd-step",
        scrollTo: { behavior: "smooth", block: "center" },
        cancelIcon: {
          enabled: true,
        },
        modalOverlayOpeningPadding: 8,
        modalOverlayOpeningRadius: 8,
        canClickTarget: false,
      },
    });

    // Step 1: Dashboard Overview
    tour.addStep({
      id: "dashboard-overview",
      title: "Welcome to PurveX",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">PurveX is your comprehensive detection validation platform. This dashboard gives you a real-time view of your security posture.</p>
          <p class="text-slate-400 text-sm">Let's explore the key features that make PurveX powerful.</p>
                    </div>
      `,
      attachTo: {
        element: "[data-tour='dashboard-header']",
        on: "bottom",
      },
      buttons: [
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
      beforeShowPromise: () => {
        return waitForElement("[data-tour='dashboard-header']", "/dashboard", 2000);
      },
    });

    // Step 2: Detections Overview
    tour.addStep({
      id: "detections-intro",
      title: "Detections Management",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">The <strong>Detections</strong> page is where you manage and validate all your security detections.</p>
          <ul class="text-slate-400 text-sm space-y-1.5 list-disc list-inside">
            <li>View detection lifecycle status</li>
            <li>Filter and search detections</li>
            <li>Run validation tests</li>
            <li>Track test results and coverage</li>
          </ul>
                    </div>
      `,
      attachTo: {
        element: "[data-tour='detections-header']",
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
      beforeShowPromise: () => {
        return waitForElement("[data-tour='detections-header']", "/detections", 2000);
      },
    });

    // Step 3: Detection Filters
    tour.addStep({
      id: "detection-filters",
      title: "Smart Filtering",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">Use the <strong>lifecycle filter</strong> to quickly find detections by their validation status.</p>
          <p class="text-slate-400 text-sm">Filter by: Validated, Needs Testing, Failed, or All detections.</p>
                    </div>
      `,
      attachTo: {
        element: "[data-tour='lifecycle-filter']",
        on: "left",
      },
      beforeShowPromise: () => {
        return waitForElement("[data-tour='lifecycle-filter']", undefined, 2000);
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
    });

    // Step 4: Search and Filters
    tour.addStep({
        id: "search-filters",
        title: "Advanced Search",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">Search and filter detections by name, technique, or any criteria.</p>
          <p class="text-slate-400 text-sm">Use the search bar and filter options to quickly find what you need.</p>
        </div>
      `,
      attachTo: {
        element: "[data-tour='search-filters']",
        on: "bottom",
      },
      beforeShowPromise: () => {
        return waitForElement("[data-tour='search-filters']", undefined, 2000);
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
    });

    // Step 5: Detection Table
    tour.addStep({
      id: "detection-table",
      title: "Detection Details",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">The detection table shows all your detections with their current status, test results, and MITRE coverage.</p>
          <p class="text-slate-400 text-sm">Click on any detection to view detailed information and run tests.</p>
        </div>
      `,
      attachTo: {
        element: "[data-tour='detection-table']",
        on: "top",
      },
      beforeShowPromise: () => {
        return waitForElement("[data-tour='detection-table']", undefined, 2000);
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
    });

    // Step 6: Tests Overview
    tour.addStep({
      id: "tests-intro",
      title: "Test Management",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">The <strong>Tests</strong> page shows your test execution history and results.</p>
          <ul class="text-slate-400 text-sm space-y-1.5 list-disc list-inside">
            <li>View all test runs and their outcomes</li>
            <li>Track test performance over time</li>
            <li>Analyze test coverage and gaps</li>
          </ul>
        </div>
      `,
      attachTo: {
        element: "[data-tour='tests-header']",
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
      beforeShowPromise: () => {
        return waitForElement("[data-tour='tests-header']", "/tests", 2000).then((element) => {
          if (!element) {
            return Promise.resolve();
          }
        });
      },
    });

    // Step 7: Explore Tests
    tour.addStep({
      id: "explore-tests",
      title: "Explore Test Library",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">Browse the <strong>Explore</strong> page to discover available test templates from the Atomic Red Team library.</p>
          <p class="text-slate-400 text-sm">Search by MITRE technique, platform, or test name to find the right test for your detections.</p>
        </div>
      `,
      attachTo: {
        element: "[data-tour='tests-explore-header']",
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
      beforeShowPromise: () => {
        return waitForElement("[data-tour='tests-explore-header']", "/tests/explore", 2000);
      },
    });

    // Step 8: MITRE Coverage
    tour.addStep({
        id: "mitre-coverage",
        title: "MITRE ATT&CK Coverage",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">The <strong>MITRE Coverage</strong> page provides a comprehensive view of your detection coverage across the MITRE ATT&CK framework.</p>
          <p class="text-slate-400 text-sm">Identify gaps in your detection coverage and prioritize improvements.</p>
        </div>
      `,
      attachTo: {
        element: "[data-tour='mitre-header']",
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
      beforeShowPromise: () => {
        return new Promise<void>((resolve) => {
          if (pathname !== "/mitre") {
            router.push("/mitre");
            setTimeout(() => resolve(), 500);
          } else {
            resolve();
          }
        });
      },
    });

    // Step 9: Settings Overview
    tour.addStep({
      id: "settings-intro",
      title: "Configuration & Settings",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">Configure PurveX to match your environment in the <strong>Settings</strong> page.</p>
          <ul class="text-slate-400 text-sm space-y-1.5 list-disc list-inside">
            <li>SIEM connections and integrations</li>
            <li>Test runners and environments</li>
            <li>Testing policies and scoring</li>
            <li>User management and permissions</li>
          </ul>
        </div>
      `,
      attachTo: {
        element: "[data-tour='settings-header']",
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: tour.next,
          classes: "shepherd-button-primary",
        },
      ],
      beforeShowPromise: () => {
        return waitForElement("[data-tour='settings-header']", "/settings", 2000);
      },
    });

    // Step 10: Settings Categories
    tour.addStep({
        id: "settings-categories",
        title: "Settings Categories",
      text: `
        <div class="space-y-3">
          <p class="text-slate-300">Navigate through different settings categories using the tabs above.</p>
          <p class="text-slate-400 text-sm">Each category contains related configuration options to customize PurveX for your organization.</p>
        </div>
      `,
      attachTo: {
        element: "[data-tour='settings-categories']",
        on: "bottom",
      },
      beforeShowPromise: () => {
        return waitForElement("[data-tour='settings-categories']", undefined, 2000);
      },
      buttons: [
        {
          text: "Back",
          action: tour.back,
          classes: "shepherd-button-secondary",
        },
        {
          text: "Finish Tour",
          action: tour.complete,
          classes: "shepherd-button-primary",
        },
      ],
    });

    // Tour event handlers
    tour.on("complete", () => {
      localStorage.setItem("purvex_tour_completed", "true");
        onClose();
    });

    tour.on("cancel", () => {
      onClose();
    });

    tour.on("show", (event) => {
      // Ensure element exists when step shows
      const step = event.step;
      if (step.options.attachTo?.element) {
        const element = typeof step.options.attachTo.element === 'string' 
          ? document.querySelector(step.options.attachTo.element) as HTMLElement
          : step.options.attachTo.element;
        
        if (!element) {
          // If element doesn't exist, make step centered
          step.options.attachTo = undefined;
        }
      }
    });

    tourInstanceRef.current = tour;
    return tour;
  };

  const handleStartTour = () => {
    setIsStarting(true);
        setTimeout(() => {
      try {
        setShowWelcome(false);
        const tour = createTour();
        if (tour) {
          tour.start();
        }
      } catch (error) {
        console.error("Error starting tour:", error);
        // Fallback: close and show error
        onClose();
      } finally {
        setIsStarting(false);
      }
    }, 300);
  };

  const handleSkip = () => {
    localStorage.setItem("purvex_tour_completed", "true");
        onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleSkip}
      />

      {/* Welcome Screen */}
      {showWelcome && (
        <div className="relative z-10 w-full max-w-2xl mx-4">
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="relative p-8 bg-gradient-to-r from-sky-500/10 via-blue-500/10 to-indigo-500/10 border-b border-slate-700/50">
              <button
                onClick={handleSkip}
                className="absolute top-4 right-4 p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
              
              <div className="flex items-center gap-4 mb-4">
                <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-sky-400" />
          </div>
                <div>
                  <h2 className="text-3xl font-bold text-white mb-1">Welcome to PurveX</h2>
                  <p className="text-slate-400">Your Detection Validation Platform</p>
              </div>
                </div>
          </div>
          
            {/* Content */}
            <div className="p-8 space-y-6">
              <p className="text-lg text-slate-300 leading-relaxed">
                Take a guided tour to discover how PurveX helps you validate detections, run tests, and improve your security posture.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                  <Shield className="h-6 w-6 text-sky-400 mb-2" />
                  <h3 className="font-semibold text-white mb-1">Detection Management</h3>
                  <p className="text-sm text-slate-400">Validate and track your security detections</p>
            </div>
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                  <Activity className="h-6 w-6 text-emerald-400 mb-2" />
                  <h3 className="font-semibold text-white mb-1">Test Execution</h3>
                  <p className="text-sm text-slate-400">Run tests and analyze results</p>
                        </div>
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                  <Target className="h-6 w-6 text-amber-400 mb-2" />
                  <h3 className="font-semibold text-white mb-1">MITRE Coverage</h3>
                  <p className="text-sm text-slate-400">Track your ATT&CK framework coverage</p>
                            </div>
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                  <Settings className="h-6 w-6 text-purple-400 mb-2" />
                  <h3 className="font-semibold text-white mb-1">Configuration</h3>
                  <p className="text-sm text-slate-400">Customize PurveX for your needs</p>
                        </div>
                            </div>

              <div className="flex items-center gap-3 pt-4">
                <Button
                  onClick={handleStartTour}
                  disabled={isStarting}
                  className="flex-1 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 text-white"
                >
                  {isStarting ? (
                    <>
                      <Zap className="h-4 w-4 mr-2 animate-pulse" />
                      Starting Tour...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Start Tour
                    </>
                  )}
                </Button>
              <Button
                  onClick={handleSkip}
                variant="outline"
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Skip Tour
              </Button>
            </div>
        </div>
      </div>
        </div>
      )}
    </div>
  );
}
