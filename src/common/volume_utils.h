// src/common/volume_utils.h
// Shared utilities for volume metadata calculations

#pragma once

#include <cstdint>
#include <limits>

namespace FSMeta {

/**
 * Checks if multiplying two uint64_t values would overflow.
 *
 * Used to safely calculate volume sizes: size = blockSize * blockCount
 * Must be called BEFORE performing the multiplication.
 *
 * @param a First operand (e.g., block size)
 * @param b Second operand (e.g., block count)
 * @return true if multiplication would overflow, false if safe
 *
 * Example usage:
 *   if (WouldOverflow(blockSize, totalBlocks)) {
 *     SetError("Total volume size calculation would overflow");
 *     return false;
 *   }
 *   uint64_t totalSize = blockSize * totalBlocks;  // Safe
 */
inline bool WouldOverflow(uint64_t a, uint64_t b) noexcept {
  // Overflow occurs if a * b > MAX, which is equivalent to a > MAX / b
  // We need b > 0 check to avoid division by zero
  return b > 0 && a > std::numeric_limits<uint64_t>::max() / b;
}

/**
 * Safely multiplies two uint64_t values, returning 0 on overflow.
 *
 * @param a First operand
 * @param b Second operand
 * @param overflow_out Optional pointer to receive overflow status
 * @return Product of a * b, or 0 if overflow would occur
 */
inline uint64_t SafeMultiply(uint64_t a, uint64_t b,
                             bool *overflow_out = nullptr) noexcept {
  bool overflow = WouldOverflow(a, b);
  if (overflow_out) {
    *overflow_out = overflow;
  }
  return overflow ? 0 : a * b;
}

} // namespace FSMeta
