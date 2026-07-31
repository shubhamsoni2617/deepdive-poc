import { ModuleRegistry } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";

const LICENSE_KEY =
  "CompanyName=Impact Analytics,LicensedGroup=31Jan22 Purchase,LicenseType=MultipleApplications,LicensedConcurrentDeveloperCount=1,LicensedProductionInstancesCount=0,AssetReference=AG-025014,ExpiryDate=31_January_2023_[v2]_MTY3NTEyMzIwMDAwMA==e4f58ef1fe10261cf66aa1e5a5cb2da6";

try {
  LicenseManager.setLicenseKey(LICENSE_KEY);
} catch (e) {
  console.warn("ag-Grid license key could not be set:", e.message);
}

ModuleRegistry.registerModules([AllEnterpriseModule]);
