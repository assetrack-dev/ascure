package local.ascure.field

import android.app.Application
import android.content.res.Configuration
import android.database.CursorWindow

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    raiseCursorWindowSize()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  /**
   * AsyncStorage can't READ a row bigger than the CursorWindow (2MB default):
   * "Row too big to fit into CursorWindow". The JS side now splits big values
   * across rows, but a phone upgraded from an older APK may already hold a
   * single-row offline queue over 2MB — raising the window lets it be read once
   * so it gets rewritten in parts. sCursorWindowSize is a hidden field; if the OS
   * blocks reflection we keep the default (JS chunking still covers new writes).
   */
  private fun raiseCursorWindowSize() {
    try {
      val field = CursorWindow::class.java.getDeclaredField("sCursorWindowSize")
      field.isAccessible = true
      field.setInt(null, 16 * 1024 * 1024)
    } catch (e: Exception) {
      // keep the platform default
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
