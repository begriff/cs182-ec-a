## Problem 1: DDPM/DDIM Fun – From a Gaussian

We assume \(X_0 \sim \mathcal N(0,\sigma^2)\) with \(\sigma^2 \ll 1\), and that in the forward diffusion process from \(t=0\) to \(t=1\), each small interval of length \(\Delta t\) adds independent Gaussian noise \(\mathcal N(0,\Delta t)\). Hence, over time \(t\), the added noise has total variance \(t\), and
\[
X_t = X_0 + \text{(Gaussian noise of variance } t\text{)} \sim \mathcal N(0,\sigma^2 + t).
\]

### (a) Distribution of \(X_1\)

At time \(t=1\), the total noise variance added is \(1\), independent of \(X_0\). Thus
\[
X_1 \sim \mathcal N(0,\sigma^2 + 1).
\]
Since \(\sigma^2 \ll 1\), this is approximately \(\mathcal N(0,1)\), but the exact answer is \(\mathcal N(0,\sigma^2 + 1)\).

### (b) Marginal distributions of \(X_{t-\Delta t}\) and \(X_t\)

By the same reasoning, at time \(t-\Delta t\) we have
\[
X_{t-\Delta t} \sim \mathcal N\bigl(0,\,\sigma^2 + t - \Delta t\bigr),
\]
and at time \(t\),
\[
X_t \sim \mathcal N\bigl(0,\,\sigma^2 + t\bigr).
\]

### (c) Approximate variance of \(X_{t-\Delta t}\mid X_t=x_t\)

We are given
\[
\bigl(X_{t-\Delta t} \mid X_t = x_t\bigr) \sim \mathcal N\!\left(
  \frac{\sigma^2 + t - \Delta t}{\sigma^2 + t}\,x_t,\;
  \frac{(\sigma^2 + t - \Delta t)\,\Delta t}{\sigma^2 + t}
\right).
\]
Let \(A = \sigma^2 + t\). Then the variance term is
\[
\frac{(\sigma^2 + t - \Delta t)\,\Delta t}{\sigma^2 + t}
  = \frac{(A - \Delta t)\,\Delta t}{A}
  = \Delta t\left(1 - \frac{\Delta t}{A}\right).
\]
Using \(\Delta t \ll \sigma^2 \ll 1\) implies \(\Delta t \ll A\), so \(\Delta t/A \ll 1\), and we can approximate
\[
\frac{(\sigma^2 + t - \Delta t)\,\Delta t}{\sigma^2 + t}
  \approx \Delta t.
\]

**Answer:** The conditional variance is approximately \(\Delta t\).

**Uncertainty note:** The approximation \(\Delta t \ll \sigma^2\) is used to drop the \(O(\Delta t^2 / (\sigma^2 + t))\) term; this is standard in diffusion limits.

### (d) Naive reverse denoising using only the conditional mean

The conditional mean mapping for a single backward step from \(t\) to \(t-\Delta t\) is
\[
\mathbb E\bigl[X_{t-\Delta t} \mid X_t = x_t\bigr]
  = \frac{\sigma^2 + t - \Delta t}{\sigma^2 + t}\,x_t
  = \left(1 - \frac{\Delta t}{\sigma^2 + t}\right)x_t.
\]
Define the deterministic factor
\[
m(t) = \frac{\sigma^2 + t - \Delta t}{\sigma^2 + t}
      = \frac{\sigma^2 + t - \Delta t}{\sigma^2 + t}.
\]
We start from \(X_1 \sim \mathcal N(0,1)\) and repeatedly apply this mean mapping backwards in \(T = 1/\Delta t\) steps: \(t_k = k\Delta t\), \(k = 1,\dots,T\). The step from \(t_k\) to \(t_{k-1}\) multiplies by
\[
m(t_k) = \frac{\sigma^2 + t_k - \Delta t}{\sigma^2 + t_k}
        = \frac{\sigma^2 + (k-1)\Delta t}{\sigma^2 + k\Delta t}.
\]
Thus the overall contraction factor from \(t=1\) to \(t=0\) is
\[
C_{\text{naive}}
  = \prod_{k=1}^{T}
    \frac{\sigma^2 + (k-1)\Delta t}{\sigma^2 + k\Delta t}.
\]
This telescopes:
\[
C_{\text{naive}}
  = \frac{\sigma^2 + 0\cdot\Delta t}{\sigma^2 + T\Delta t}
  = \frac{\sigma^2}{\sigma^2 + 1}.
\]
Therefore, the naive reverse sample is
\[
\hat X_0 = C_{\text{naive}} X_1 = \frac{\sigma^2}{\sigma^2 + 1} X_1.
\]
Since \(X_1 \sim \mathcal N(0,1)\), we get
\[
\hat X_0 \sim \mathcal N\!\left(0,\left(\frac{\sigma^2}{\sigma^2 + 1}\right)^2\right).
\]
For \(\sigma^2 \ll 1\), this variance is approximately \(\sigma^4 \ll \sigma^2\), i.e. **far too small** compared to the desired variance \(\sigma^2\).

### (e) Adding stochastic noise at each reverse step: variance in the \(\Delta t \to 0\) limit

We are given that with independent \(\mathcal N(0,\Delta t)\) noise added at each of the \(T=1/\Delta t\) reverse steps, the variance of \(\hat X_0\) is
\[
\operatorname{Var}(\hat X_0)
  = \left(\frac{\sigma^2}{\sigma^2 + 1}\right)^2
    + \Delta t \sum_{k=0}^{T-1}
      \left(\frac{\sigma^2}{\sigma^2 + k\Delta t}\right)^2.
\tag{1}
\]
We take \(\Delta t \to 0\) with \(T = 1/\Delta t\) and approximate the sum by an integral:
\[
\Delta t \sum_{k=0}^{T-1}
  \left(\frac{\sigma^2}{\sigma^2 + k\Delta t}\right)^2
  \;\xrightarrow[\Delta t \to 0]{}\;
  \int_0^1 \left(\frac{\sigma^2}{\sigma^2 + t}\right)^2 dt.
\]
So, in the limit,
\[
\operatorname{Var}(\hat X_0)
  \approx
  \left(\frac{\sigma^2}{\sigma^2 + 1}\right)^2
  + \int_0^1 \left(\frac{\sigma^2}{\sigma^2 + t}\right)^2 dt.
\]
Evaluate the integral:
\[
\int_0^1 \left(\frac{\sigma^2}{\sigma^2 + t}\right)^2 dt
  = \int_0^1 \frac{\sigma^4}{(\sigma^2 + t)^2} \, dt.
\]
Let \(u = \sigma^2 + t\), so \(du = dt\), and when \(t=0\), \(u = \sigma^2\); when \(t=1\), \(u = \sigma^2 + 1\). Then
\[
\int_0^1 \frac{\sigma^4}{(\sigma^2 + t)^2} \, dt
  = \sigma^4 \int_{\sigma^2}^{\sigma^2 + 1} \frac{1}{u^2} du
  = \sigma^4\left[-\frac{1}{u}\right]_{\sigma^2}^{\sigma^2 + 1}
  = \sigma^4\left(\frac{1}{\sigma^2} - \frac{1}{\sigma^2 + 1}\right).
\]
Simplify:
\[
\int_0^1 \left(\frac{\sigma^2}{\sigma^2 + t}\right)^2 dt
  = \sigma^2 - \frac{\sigma^4}{\sigma^2 + 1}.
\]
Thus,
\[
\operatorname{Var}(\hat X_0)
  \approx
  \left(\frac{\sigma^2}{\sigma^2 + 1}\right)^2
  + \sigma^2 - \frac{\sigma^4}{\sigma^2 + 1}.
\]
For \(\sigma^2 \ll 1\), the dominant term is \(\sigma^2\), and the remaining terms are \(O(\sigma^4)\). Therefore,
\[
\operatorname{Var}(\hat X_0) \approx \sigma^2
\]
up to small corrections of order \(\sigma^4\).

**Uncertainty note:** The passage from the discrete sum to the integral and the dropping of \(O(\sigma^4)\) terms are standard continuum/perturbative approximations; for very small but not infinitesimal \(\sigma^2\), the result will be very close but not exactly equal to \(\sigma^2\).

### (f) Training a neural network to approximate \(g(x_t,t) = \dfrac{\sigma^2}{\sigma^2 + t} x_t\)

We are given only samples \(s_i\) drawn from the distribution of \(X_0\).

**Inputs to the network:**
- An input pair \((x_t, t)\), where:
  - \(x_t\) is a noisy version of a data sample \(s\) at time \(t\),
  - \(t\) is the (scalar) time, typically encoded (e.g., via positional/time embedding) and concatenated to the input.

**How to generate a training batch:**
1. Sample a minibatch of data points \(s_1,\dots,s_B\) from the dataset (these play the role of \(X_0\)).
2. For each \(s_i\), sample a time \(t_i \sim \mathrm{Uniform}(0,1)\).
3. For each \(s_i,t_i\), sample a forward-noise variable \(\epsilon_i \sim \mathcal N(0,1)\) and construct
   \[
   x_{t_i} = s_i + \sqrt{t_i}\,\epsilon_i,
   \]
   which matches the forward process \(X_t \mid X_0 = s_i \sim \mathcal N(s_i,t_i)\).
4. Feed \((x_{t_i}, t_i)\) into the neural net \(g_\theta\) to obtain a prediction \(g_\theta(x_{t_i}, t_i)\).

**Loss function:**
- Since \(g(x_t,t) = \mathbb E[X_0 \mid X_t=x_t]\), a natural training target is the original clean sample \(s_i = X_0\).
- Use an MSE loss to encourage \(g_\theta\) to approximate the conditional mean:
  \[
  \mathcal L(\theta)
    = \mathbb E_{s,t,\epsilon}
      \bigl[
        \| g_\theta(x_t,t) - s \|^2
      \bigr].
  \]
- In practice, approximate the expectation by an average over the minibatch, and then apply an optimizer like AdamW to minimize \(\mathcal L(\theta)\).

In this toy Gaussian case, the optimal \(g_\theta\) converges to the analytic form \(g(x_t,t) = \frac{\sigma^2}{\sigma^2 + t} x_t\).

**Uncertainty note:** I am following the standard DDPM training formulation (predicting clean \(X_0\) from \((x_t,t)\)); equivalently, one could train to predict the noise \(\epsilon\). Both choices would recover the same conditional mean in this 1D Gaussian setting.

### (g) Approximate DDIM step for \(\Delta t \ll t\)

We are told that DDIM takes a smaller deterministic step:
\[
x^{\mathrm{DDIM}}_{t-\Delta t}
  = x_t + \eta(t,\Delta t)\,\bigl(\text{deterministic DDPM step}\bigr),
\]
where the deterministic DDPM step is
\[
\Delta x_{\text{DDPM}} = -\frac{\Delta t}{\sigma^2 + t}\,x_t,
\]
and
\[
\eta(t,\Delta t)
  = \frac{\sqrt{t}}{\sqrt{t-\Delta t} + \sqrt{t}}.
\]

For \(\Delta t \ll t\), we approximate
\[
\sqrt{t-\Delta t}
  \approx \sqrt{t} - \frac{\Delta t}{2\sqrt{t}},
\]
so the denominator is
\[
\sqrt{t-\Delta t} + \sqrt{t}
  \approx 2\sqrt{t} - \frac{\Delta t}{2\sqrt{t}}
  = 2\sqrt{t}\left(1 - \frac{\Delta t}{4t}\right).
\]
Hence
\[
\eta(t,\Delta t)
  = \frac{\sqrt{t}}{\sqrt{t-\Delta t} + \sqrt{t}}
  \approx \frac{\sqrt{t}}{2\sqrt{t}\left(1 - \frac{\Delta t}{4t}\right)}
  \approx \frac{1}{2},
\]
up to corrections of order \(\Delta t/t\).

Plugging this into the DDIM update:
\[
x^{\mathrm{DDIM}}_{t-\Delta t}
  \approx x_t + \frac{1}{2}\left(-\frac{\Delta t}{\sigma^2 + t} x_t\right)
  = \left(1 - \frac{\Delta t}{2(\sigma^2 + t)}\right)x_t.
\]

**Answer:** For \(\Delta t \ll t\), the approximate DDIM step is
\[
x^{\mathrm{DDIM}}_{t-\Delta t}
  \approx \left(1 - \frac{\Delta t}{2(\sigma^2 + t)}\right)x_t.
\]

**Uncertainty note:** The exact form of \(\eta(t,\Delta t)\) in the PDF is slightly ambiguous after text extraction; I have interpreted it as \(\eta(t,\Delta t)=\frac{\sqrt{t}}{\sqrt{t-\Delta t}+\sqrt{t}}\), which is dimensionally consistent and yields the standard small-\(\Delta t\) approximation \(\eta\approx \tfrac12\).

### (h) Distribution of \(\hat X_0\) after all DDIM steps

We now apply the DDIM step from part (g) repeatedly from \(t=1\) back to \(t=0\), starting from \(\hat X_1 \sim \mathcal N(0,1)\). Using the approximate multiplicative factor from (g), the step from time \(t\) to \(t-\Delta t\) multiplies by
\[
r(t) = 1 - \frac{\Delta t}{2(\sigma^2 + t)}.
\]
Let \(t_k = k\Delta t\), \(k=1,\dots,T\) with \(T=1/\Delta t\). Then
\[
\hat X_0
  = \hat X_1 \prod_{k=1}^{T} r(t_k)
  \approx \hat X_1
   \prod_{k=1}^{T}
   \left(1 - \frac{\Delta t}{2(\sigma^2 + t_k)}\right).
\]
Define the total contraction factor
\[
C_{\mathrm{DDIM}}
  = \prod_{k=1}^{T}
   \left(1 - \frac{\Delta t}{2(\sigma^2 + t_k)}\right).
\]
Take logarithms and use \(\ln(1 - x) \approx -x\) for \(0 < x \ll 1\) (with \(\Delta t \ll \sigma^2 + t_k\)):
\[
\ln C_{\mathrm{DDIM}}
  \approx \sum_{k=1}^{T}
   \ln\left(1 - \frac{\Delta t}{2(\sigma^2 + t_k)}\right)
  \approx -\sum_{k=1}^{T}
     \frac{\Delta t}{2(\sigma^2 + t_k)}.
\]
As \(\Delta t \to 0\), the Riemann sum becomes an integral:
\[
\ln C_{\mathrm{DDIM}}
  \xrightarrow[\Delta t \to 0]{}
  -\frac{1}{2} \int_0^1 \frac{dt}{\sigma^2 + t}
  = -\frac{1}{2}\left[\ln(\sigma^2 + t)\right]_0^1
  = -\frac{1}{2}\bigl(\ln(\sigma^2 + 1) - \ln(\sigma^2)\bigr).
\]
Therefore,
\[
C_{\mathrm{DDIM}}
  = \exp\left(-\frac{1}{2}\bigl(\ln(\sigma^2 + 1) - \ln(\sigma^2)\bigr)\right)
  = \left(\frac{\sigma^2}{\sigma^2 + 1}\right)^{1/2}.
\]
Hence
\[
\hat X_0 = C_{\mathrm{DDIM}} \hat X_1,
\]
and since \(\hat X_1 \sim \mathcal N(0,1)\),
\[
\hat X_0 \sim \mathcal N\!\left(0,\,C_{\mathrm{DDIM}}^2\right)
  = \mathcal N\!\left(0,\,\frac{\sigma^2}{\sigma^2 + 1}\right).
\]
For \(\sigma^2 \ll 1\), this variance is
\[
\frac{\sigma^2}{\sigma^2 + 1} \approx \sigma^2,
\]
so DDIM with this choice of step size and added noise approximately recovers the correct variance of the target distribution \(X_0\).

**Uncertainty note:** The approximation uses (i) the small-\(\Delta t\) expansion of \(\ln(1-x)\), and (ii) the continuum limit that turns the product into an exponential of an integral. Both are standard in analyzing diffusion-type discretizations; residual errors are \(O(\Delta t)\) and vanish as \(\Delta t \to 0\).


