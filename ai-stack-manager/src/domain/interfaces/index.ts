/**
 * @module domain/interfaces
 * @description Repository and service interfaces (ports) for the domain layer.
 * Infrastructure implementations provide the concrete adapters.
 */

import { Package, InstallStatus } from '../entities/Package';
import { Bundle } from '../entities/Bundle';
import { HealthReport } from '../entities/HealthReport';

/** Read-only access to the package catalog */
export interface IPackageRepository {
  /** Get all available packages */
  getAll(): Promise<Package[]>;
  /** Find a package by ID */
  findById(id: string): Promise<Package | undefined>;
  /** Search packages by query */
  search(query: string): Promise<Package[]>;
  /** Get all bundles */
  getAllBundles(): Promise<Bundle[]>;
  /** Find a bundle by ID */
  findBundleById(id: string): Promise<Bundle | undefined>;
  getAgentNetwork(agentId: string): Promise<Package[]>;
  getRelatedSkills(agentId: string): Promise<Package[]>;
}

/** Detects what's installed in the current workspace */
export interface IWorkspaceScanner {
  /** Get the installation status of a specific package */
  getInstallStatus(pkg: Package): Promise<InstallStatus>;
  /** Get all installed package IDs */
  getInstalledPackageIds(): Promise<string[]>;
  /** Check if workspace has a .github directory */
  hasGitHubDirectory(): Promise<boolean>;
  detectProjectProfile(): Promise<{ profile: string; bundleId: string; confidence: number; }[]>;
}

/** Installs and uninstalls packages in the workspace */
export interface IInstaller {
  /** Install a package into the workspace */
  install(pkg: Package): Promise<void>;
  /** Uninstall a package from the workspace */
  uninstall(pkg: Package): Promise<void>;
  /** Install multiple packages (bundle) */
  installMany(packages: Package[]): Promise<void>;
}

/** Validates AI infrastructure integrity */
export interface IHealthChecker {
  /** Run a full health check on the workspace */
  check(): Promise<HealthReport>;
}

export interface IInstallTracker {
  trackInstall(pkg: Package): Promise<void>;
}
