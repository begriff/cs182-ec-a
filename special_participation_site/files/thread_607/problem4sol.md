## Problem 4: Diffusion Models

We are given a forward diffusion process over \(T\) steps:
\[
q(x_t \mid x_{t-1}) = \mathcal N\!\bigl(x_t;\,\sqrt{1-\beta_t}\,x_{t-1},\,\beta_t I\bigr),
\qquad
q(x_{1:T}\mid x_0) = \prod_{t=1}^T q(x_t\mid x_{t-1}),
\]
where \(0 < \beta_t < 1\) are small noise variances and \(x_0 \sim q(x)\) (assumed Gaussian).
Define
\[
\alpha_t \coloneqq \prod_{s=1}^t (1-\beta_s),\qquad \alpha_0 \coloneqq 1.
\]
This is the usual DDPM notation. We treat all covariances as isotropic (\(\propto I\)).

---

### (a) Anytime sampling from intermediate distributions \(q(x_t\mid x_0)\)

**Goal:** Show that there is a closed-form expression
\[
q(x_t\mid x_0) = \mathcal N\!\bigl(x_t;\,\sqrt{\alpha_t}\,x_0,\,(1-\alpha_t)I\bigr).
\]

We prove this by induction on \(t\).

#### Base case \(t=1\)

From the forward kernel,
\[
q(x_1\mid x_0) = \mathcal N\!\bigl(x_1;\,\sqrt{1-\beta_1}\,x_0,\,\beta_1 I\bigr).
\]
By definition, \(\alpha_1 = 1-\beta_1\), so
\[
q(x_1\mid x_0)
  = \mathcal N\!\bigl(x_1;\,\sqrt{\alpha_1}\,x_0,\,(1-\alpha_1)I\bigr),
\]
which matches the desired form.

#### Inductive step

Assume for some \(t-1 \ge 1\) that
\[
q(x_{t-1}\mid x_0)
  = \mathcal N\!\bigl(x_{t-1};\,\sqrt{\alpha_{t-1}}\,x_0,\,(1-\alpha_{t-1})I\bigr).
\]
We want \(q(x_t\mid x_0)\).

We have
\[
q(x_t\mid x_0)
  = \int q(x_t\mid x_{t-1})\,q(x_{t-1}\mid x_0)\,dx_{t-1},
\]
where
\[
q(x_t\mid x_{t-1})
  = \mathcal N\!\bigl(x_t;\,\sqrt{1-\beta_t}\,x_{t-1},\,\beta_t I\bigr).
\]
This is the distribution of a linear–Gaussian transformation of a Gaussian:
\[
x_{t-1}\mid x_0 \sim
  \mathcal N\!\bigl(\sqrt{\alpha_{t-1}}\,x_0,\,(1-\alpha_{t-1})I\bigr),
\]
and
\[
x_t = \sqrt{1-\beta_t}\,x_{t-1} + \epsilon_t,\qquad
\epsilon_t \sim \mathcal N(0,\beta_t I),\ \epsilon_t\perp x_{t-1}.
\]
Therefore \(x_t\mid x_0\) is also Gaussian with
\[
\mathbb E[x_t\mid x_0]
  = \sqrt{1-\beta_t}\,\mathbb E[x_{t-1}\mid x_0]
  = \sqrt{1-\beta_t}\,\sqrt{\alpha_{t-1}}\,x_0
  = \sqrt{\alpha_{t-1}(1-\beta_t)}\,x_0
  = \sqrt{\alpha_t}\,x_0,
\]
where we used \(\alpha_t = \alpha_{t-1}(1-\beta_t)\).

For the covariance:
\[
\begin{aligned}
\mathrm{Var}(x_t\mid x_0)
  &= (1-\beta_t)\,\mathrm{Var}(x_{t-1}\mid x_0) + \beta_t I \\
  &= (1-\beta_t)\,(1-\alpha_{t-1})I + \beta_t I \\
  &= \bigl(1 - \beta_t - \alpha_{t-1} + \alpha_{t-1}\beta_t + \beta_t\bigr)I \\
  &= \bigl(1 - \alpha_{t-1}(1-\beta_t)\bigr)I
   = (1-\alpha_t)I.
\end{aligned}
\]
So
\[
q(x_t\mid x_0)
  = \mathcal N\!\bigl(x_t;\,\sqrt{\alpha_t}\,x_0,\,(1-\alpha_t)I\bigr),
\]
which completes the induction.

**Conclusion:** For all \(t\),
\[
q(x_t\mid x_0)
  = \mathcal N\!\bigl(x_t;\,\sqrt{\alpha_t}\,x_0,\,(1-\alpha_t)I\bigr).
\]

**Uncertainty note:** This derivation assumes the forward kernel is precisely \(q(x_t\mid x_{t-1}) = \mathcal N(x_t;\sqrt{1-\beta_t}x_{t-1},\beta_t I)\); the original PDF text had minor formatting artifacts, but this is the standard DDPM setup.

---

### (b) Reverse conditional \(q(x_{t-1}\mid x_t, x_0)\)

We want the reverse conditional distribution
\[
q(x_{t-1}\mid x_t, x_0),
\]
which, by Bayes’ rule and the Markov structure, is proportional to
\[
q(x_t\mid x_{t-1})\,q(x_{t-1}\mid x_0).
\]

From part (a),
\[
q(x_{t-1}\mid x_0)
  = \mathcal N\!\bigl(x_{t-1};\,\sqrt{\alpha_{t-1}}\,x_0,\,(1-\alpha_{t-1})I\bigr),
\]
and the forward kernel is
\[
q(x_t\mid x_{t-1})
  = \mathcal N\!\bigl(x_t;\,\sqrt{1-\beta_t}\,x_{t-1},\,\beta_t I\bigr).
\]
Both are Gaussians in \(x_{t-1}\) with isotropic covariances, so their product is also Gaussian in \(x_{t-1}\).

#### Computing the reverse variance \(\hat\beta_t\)

Write
\[
q(x_{t-1}\mid x_0)
  \propto \exp\left(
    -\frac{1}{2(1-\alpha_{t-1})}\,\|x_{t-1}-\sqrt{\alpha_{t-1}}\,x_0\|^2
  \right),
\]
and
\[
q(x_t\mid x_{t-1})
  \propto \exp\left(
    -\frac{1}{2\beta_t}\,\|x_t-\sqrt{1-\beta_t}\,x_{t-1}\|^2
  \right).
\]
Multiplying gives
\[
q(x_{t-1}\mid x_t,x_0)
  \propto \exp\bigl(-\tfrac12 x_{t-1}^\top A x_{t-1} + b^\top x_{t-1} + \text{const}\bigr),
\]
with precision matrix
\[
A = \frac{1-\beta_t}{\beta_t}I + \frac{1}{1-\alpha_{t-1}}I
  = \left(\frac{1-\beta_t}{\beta_t} + \frac{1}{1-\alpha_{t-1}}\right)I.
\]
We can identify the reverse covariance as
\[
\hat\beta_t I = A^{-1},
\qquad
\hat\beta_t
  = \left(
       \frac{1-\beta_t}{\beta_t}
       + \frac{1}{1-\alpha_{t-1}}
    \right)^{-1}.
\]
Simplify the scalar:
\[
\begin{aligned}
\frac{1}{\hat\beta_t}
  &= \frac{1-\beta_t}{\beta_t} + \frac{1}{1-\alpha_{t-1}} \\
  &= \frac{(1-\beta_t)(1-\alpha_{t-1}) + \beta_t}
          {\beta_t(1-\alpha_{t-1})} \\
  &= \frac{1 - \alpha_{t-1} + \alpha_{t-1}\beta_t}
          {\beta_t(1-\alpha_{t-1})} \\
  &= \frac{1 - \alpha_{t-1}(1-\beta_t)}
          {\beta_t(1-\alpha_{t-1})}
   = \frac{1-\alpha_t}{\beta_t(1-\alpha_{t-1})},
\end{aligned}
\]
using \(\alpha_t = \alpha_{t-1}(1-\beta_t)\).
Thus
\[
\hat\beta_t
  = \frac{\beta_t(1-\alpha_{t-1})}{1-\alpha_t}.
\]

#### Computing the reverse mean \(\mu(x_t,x_0)\)

The mean of a Gaussian with precision \(A\) is \(A^{-1}b = \hat\beta_t b\), where \(b\) is the linear coefficient in the exponent.

From the product:
- The term from \(q(x_{t-1}\mid x_0)\) contributes
  \[
  \frac{\sqrt{\alpha_{t-1}}}{1-\alpha_{t-1}}\,x_0
  \]
  to \(b\).
- The term from \(q(x_t\mid x_{t-1})\) is
  \[
  -\frac{1}{2\beta_t}
    \|x_t-\sqrt{1-\beta_t}\,x_{t-1}\|^2
  = -\frac{1}{2\beta_t}
    \bigl(
      \|x_t\|^2
      + (1-\beta_t)\|x_{t-1}\|^2
      - 2\sqrt{1-\beta_t}\,x_t^\top x_{t-1}
    \bigr),
  \]
  which contributes
  \[
  \frac{\sqrt{1-\beta_t}}{\beta_t}\,x_t
  \]
  to \(b\).

So
\[
b
  = \frac{\sqrt{1-\beta_t}}{\beta_t}\,x_t
    + \frac{\sqrt{\alpha_{t-1}}}{1-\alpha_{t-1}}\,x_0.
\]
Therefore,
\[
\mu(x_t,x_0)
  = \hat\beta_t\,b
  = \hat\beta_t
    \left(
      \frac{\sqrt{1-\beta_t}}{\beta_t}\,x_t
      + \frac{\sqrt{\alpha_{t-1}}}{1-\alpha_{t-1}}\,x_0
    \right).
\]
Using \(\hat\beta_t = \dfrac{\beta_t(1-\alpha_{t-1})}{1-\alpha_t}\), we can rewrite this as
\[
\mu(x_t,x_0)
  = \frac{\sqrt{1-\beta_t}(1-\alpha_{t-1})}{1-\alpha_t}\,x_t
    + \frac{\sqrt{\alpha_{t-1}}\beta_t}{1-\alpha_t}\,x_0.
\]
This is the standard DDPM reverse mean conditioned on both \(x_t\) and \(x_0\).

#### Final reverse distribution

Putting the pieces together:
\[
q(x_{t-1}\mid x_t,x_0)
  = \mathcal N\!\bigl(x_{t-1};\,\mu(x_t,x_0),\,\hat\beta_t I\bigr),
\]
where
\[
\hat\beta_t
  = \frac{\beta_t(1-\alpha_{t-1})}{1-\alpha_t},
\]
and
\[
\mu(x_t,x_0)
  = \frac{\sqrt{1-\beta_t}(1-\alpha_{t-1})}{1-\alpha_t}\,x_t
    + \frac{\sqrt{\alpha_{t-1}}\beta_t}{1-\alpha_t}\,x_0.
\]

**Uncertainty note:** The main algebraic steps are (i) multiplying two Gaussians with isotropic covariances and (ii) simplifying the scalar expression for \(\hat\beta_t\) using \(\alpha_t=\alpha_{t-1}(1-\beta_t)\). The resulting formulas match standard DDPM reverse-conditionals when expressed in terms of \(\alpha_t\) and \(\beta_t\).


