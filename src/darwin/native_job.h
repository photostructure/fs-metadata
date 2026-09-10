// macOS work that may never return must not occupy libuv's joined threadpool.
#pragma once

#include <atomic>
#include <chrono>
#include <exception>
#include <memory>
#include <napi.h>
#include <stdexcept>
#include <string>

namespace FSMeta {

Napi::Error NativeSystemError(Napi::Env env, const std::string &message,
                              int code, const std::string &syscall,
                              const std::string &path);

class NativeJob {
public:
  using Clock = std::chrono::steady_clock;
  explicit NativeJob(uint32_t timeoutMs)
      : deadline_(timeoutMs == 0
                      ? Clock::time_point::max()
                      : Clock::now() + std::chrono::milliseconds(timeoutMs)) {}
  virtual ~NativeJob() = default;
  NativeJob(const NativeJob &) = delete;
  NativeJob &operator=(const NativeJob &) = delete;
  NativeJob(NativeJob &&) = delete;
  NativeJob &operator=(NativeJob &&) = delete;

  bool IsCancelled() const {
    return cancelled_.load(std::memory_order_relaxed) || Expired();
  }
  bool Expired() const { return Clock::now() >= deadline_; }
  void Cancel() { cancelled_.store(true, std::memory_order_relaxed); }
  bool Ready() const { return ready_.load(std::memory_order_acquire); }
  // Only read after Ready(), like the other result fields.
  bool TimedOut() const { return timedOut_; }

  // Only called on a detached thread. Publish every result/error write before
  // the event-loop thread reads it. No JS handles or env live in this object.
  void Run() noexcept {
    try {
      if (!IsCancelled())
        Execute();
    } catch (...) {
      exception_ = std::current_exception();
    }
    timedOut_ = Expired();
    ready_.store(true, std::memory_order_release);
  }

  // Only called on the event-loop thread, after Ready().
  Napi::Value Result(Napi::Env env) {
    if (exception_)
      std::rethrow_exception(exception_);
    if (errorCode_ != 0)
      throw NativeSystemError(env, error_, errorCode_, errorSyscall_,
                              errorPath_);
    if (!error_.empty())
      throw std::runtime_error(error_);
    return ToValue(env);
  }

protected:
  virtual void Execute() = 0;
  virtual Napi::Value ToValue(Napi::Env env) = 0;
  void SetError(const std::string &error, int code = 0,
                const std::string &syscall = {}, const std::string &path = {}) {
    error_ = error;
    errorCode_ = code;
    errorSyscall_ = syscall;
    errorPath_ = path;
  }

private:
  const Clock::time_point deadline_;
  std::atomic<bool> cancelled_{false};
  std::atomic<bool> ready_{false};
  std::string error_;
  int errorCode_ = 0;
  std::string errorSyscall_;
  std::string errorPath_;
  std::exception_ptr exception_;
  bool timedOut_ = false;
};

// Limits apply across all Node Worker environments using this addon image.
// Each request has an event-loop timer; none waits on libuv's worker pool.
Napi::Promise QueueNativeJob(Napi::Env env, std::shared_ptr<NativeJob> job);

} // namespace FSMeta
