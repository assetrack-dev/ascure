# Globally link the C++ shared runtime (libc++_shared) into every native target.
#
# On Windows the NDK links shared libraries with `-Wl,--no-undefined` (inherited
# from the React Native prefab), but the toolchain here does NOT auto-add the C++
# STL, so libc++ symbols (__cxa_*, operator new/delete, std::__ndk1::*,
# std::bad_alloc, ...) are reported as undefined at link time and the build fails.
#
# This file is pulled in via -DCMAKE_PROJECT_INCLUDE (wired up in build.gradle),
# which CMake includes right after every project() call. Declaring the link here
# covers every third-party module AND the app's generated react_codegen_* targets
# in one place, instead of patching each module's CMakeLists individually.
link_libraries(c++_shared)
