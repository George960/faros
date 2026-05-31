// In android/app/src/main/java/com/faros/MainApplication.kt,
// inside getPackages(), add FarosBlePackage() to the PackageList:
//
//   override fun getPackages(): List<ReactPackage> =
//       PackageList(this).packages.apply {
//           add(com.faros.ble.FarosBlePackage())
//       }
