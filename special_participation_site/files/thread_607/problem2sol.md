## Problem 2: Honey, Where’s My Reward Model?

We work through all parts (a)–(g), using the notation from the problem.

---

### (a) Optimal \(p^\*\) for \(\min_{p \in \mathcal P} D_{\mathrm{KL}}(p\|q)\)

Recall
\[
D_{\mathrm{KL}}(p\|q)
  = \sum_x p(x)\log\frac{p(x)}{q(x)} \ge 0.
\]
By Gibbs’ inequality, \(D_{\mathrm{KL}}(p\|q) \ge 0\) with equality **if and only if** \(p(x) = q(x)\) for all \(x\) (on the support where \(q(x) > 0\)).
Therefore, the minimizer is
\[
p^\*(x) = q(x)\quad\text{for all }x.
\]

**Uncertainty note:** This relies on the standard inequality \(\sum_x p(x)\log\frac{p(x)}{q(x)} \ge 0\); a full proof uses convexity of \(\log\) or Jensen’s inequality.

---

### (b) Optimal policy \(\pi_\theta^\*(y\mid x)\) with KL regularization

For a fixed prompt \(x\), define the objective over distributions \(\pi(\cdot\mid x)\) on responses \(y\):
\[
J_x(\pi)
  = \mathbb E_{y\sim\pi(\cdot\mid x)}[r_\phi(x,y)]
    - \beta D_{\mathrm{KL}}(\pi(\cdot\mid x)\,\|\,\pi_{\mathrm{ref}}(\cdot\mid x)).
\]
Write out the expectation and KL explicitly:
\[
J_x(\pi)
  = \sum_y \pi(y\mid x) r_\phi(x,y)
    - \beta \sum_y \pi(y\mid x)
      \log\frac{\pi(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}.
\]
Rearrange the terms by factoring out \(-\beta\):
\[
J_x(\pi)
  = -\beta \sum_y \pi(y\mid x)
     \log\frac{\pi(y\mid x)}
               {\pi_{\mathrm{ref}}(y\mid x)\exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right)}
  + \beta \log Z(x),
\]
where we have introduced
\[
Z(x)
  = \sum_y \pi_{\mathrm{ref}}(y\mid x)\exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right),
\]
and used the fact that
\[
\sum_y \pi(y\mid x) \left[
  r_\phi(x,y) - \beta \log \pi_{\mathrm{ref}}(y\mid x)
\right]
  = \beta \sum_y \pi(y\mid x)
    \log\bigl(\pi_{\mathrm{ref}}(y\mid x)e^{r_\phi(x,y)/\beta}\bigr).
\]
Define the “Boltzmannized” reference distribution
\[
\tilde\pi(y\mid x)
  = \frac{1}{Z(x)}\,
    \pi_{\mathrm{ref}}(y\mid x)\exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right).
\]
Then
\[
J_x(\pi)
  = -\beta\,D_{\mathrm{KL}}(\pi(\cdot\mid x)\,\|\,\tilde\pi(\cdot\mid x))
    + \beta\log Z(x).
\]
Since \(\beta > 0\) and KL is minimized when \(\pi = \tilde\pi\), the maximizing policy is
\[
\pi_\theta^\*(y\mid x)
  = \tilde\pi(y\mid x)
  = \frac{1}{Z(x)}\,
    \pi_{\mathrm{ref}}(y\mid x)\exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right),
\]
with
\[
Z(x) = \sum_y \pi_{\mathrm{ref}}(y\mid x)\exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right).
\]

This matches the desired form.

---

### (c) Why is \(\pi_\theta^\*(y\mid x)\) hard to use directly?

The expression
\[
\pi_\theta^\*(y\mid x)
  = \frac{1}{Z(x)}\,\pi_{\mathrm{ref}}(y\mid x)
    \exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right)
\]
requires knowledge of the **partition function**
\[
Z(x) = \sum_y \pi_{\mathrm{ref}}(y\mid x)\exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right),
\]
which is a sum over the entire output space \(\mathcal Y\).

In the language modeling setting, \(\mathcal Y\) is the set of all possible text sequences (potentially of unbounded length), which is astronomically large. Computing this sum exactly is intractable, and even approximating it well can be very expensive. Hence, although the closed form is conceptually nice, it is not directly practical for large LMs.

---

### (d) Expressing \(r_\phi(x,y)\) in terms of \(\pi_\theta^\*\), \(\pi_{\mathrm{ref}}\), and \(Z(x)\)

From part (b), for any \(x,y\),
\[
\pi_\theta^\*(y\mid x)
  = \frac{1}{Z(x)}\,\pi_{\mathrm{ref}}(y\mid x)
    \exp\left(\tfrac{1}{\beta}r_\phi(x,y)\right).
\]
Take logs:
\[
\log \pi_\theta^\*(y\mid x)
  = \log \pi_{\mathrm{ref}}(y\mid x)
    + \frac{1}{\beta}r_\phi(x,y)
    - \log Z(x).
\]
Solve for \(r_\phi(x,y)\):
\[
r_\phi(x,y)
  = \beta\Bigl(\log \pi_\theta^\*(y\mid x)
               - \log \pi_{\mathrm{ref}}(y\mid x)
               + \log Z(x)\Bigr).
\]
Equivalently,
\[
r_\phi(x,y)
  = \beta \log \frac{\pi_\theta^\*(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}
    + \beta \log Z(x).
\]

This is the **implicit reward parametrization** used later.

---

### (e) Bradley–Terry probability in terms of the optimal policy and cancellation of \(Z(x)\)

The Bradley–Terry model says
\[
p^\*(y_w \succ y_l\mid x)
  = \sigma\bigl(r_\phi(x,y_w) - r_\phi(x,y_l)\bigr).
\]
Using the expression from part (d):
\[
r_\phi(x,y)
  = \beta \log\frac{\pi_\theta^\*(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}
    + \beta\log Z(x).
\]
Therefore
\[
\begin{aligned}
r_\phi(x,y_w) - r_\phi(x,y_l)
  &= \beta \log\frac{\pi_\theta^\*(y_w\mid x)}{\pi_{\mathrm{ref}}(y_w\mid x)}
     + \beta\log Z(x) \\
  &\quad
     - \Bigl[
          \beta \log\frac{\pi_\theta^\*(y_l\mid x)}{\pi_{\mathrm{ref}}(y_l\mid x)}
          + \beta\log Z(x)
       \Bigr] \\
  &= \beta \log\frac{\pi_\theta^\*(y_w\mid x)}{\pi_{\mathrm{ref}}(y_w\mid x)}
     - \beta \log\frac{\pi_\theta^\*(y_l\mid x)}{\pi_{\mathrm{ref}}(y_l\mid x)}.
\end{aligned}
\]
The \(\beta\log Z(x)\) terms **cancel**.

Thus,
\[
p^\*(y_w \succ y_l\mid x)
  = \sigma\!\left(
      \beta \log\frac{\pi_\theta^\*(y_w\mid x)}{\pi_{\mathrm{ref}}(y_w\mid x)}
      - \beta \log\frac{\pi_\theta^\*(y_l\mid x)}{\pi_{\mathrm{ref}}(y_l\mid x)}
    \right).
\]

This leads to the DPO maximum-likelihood objective over a parameterized policy \(\pi_\theta\) (replacing \(\pi_\theta^\*\) with \(\pi_\theta\)):
\[
L_{\mathrm{DPO}}(\pi_\theta;\pi_{\mathrm{ref}})
  = -\mathbb E_{(x,y_w,y_l)\sim\mathcal D}
    \left[
      \log \sigma\!\left(
        \beta \log\frac{\pi_\theta(y_w\mid x)}{\pi_{\mathrm{ref}}(y_w\mid x)}
        - \beta \log\frac{\pi_\theta(y_l\mid x)}{\pi_{\mathrm{ref}}(y_l\mid x)}
      \right)
    \right].
\]

**Why is cancellation of \(Z(x)\) desirable?**
- We no longer need to compute or approximate the partition function \(Z(x)\), which would require a sum over all possible outputs \(y\).
- The objective depends only on log-density ratios between the current policy and the reference policy at the **observed** samples \(y_w, y_l\), making training feasible.

**Uncertainty note:** The main subtlety is treating the target \(\pi_\theta^\*\) as a stand-in for the parameterized \(\pi_\theta\) we actually optimize; in practice we just plug \(\pi_\theta\) into this form and do MLE.

---

### (f) Gradient of the DPO loss and role of the weighting term

Define the implicit reward
\[
\hat r_\theta(x,y)
  = \beta \log\frac{\pi_\theta(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}.
\]
For a single preference data point \((x,y_w,y_l)\), the DPO loss term is
\[
\ell(\theta; x,y_w,y_l)
  = -\log \sigma\!\left(
      \hat r_\theta(x,y_w) - \hat r_\theta(x,y_l)
    \right).
\]
Let
\[
z
  = \hat r_\theta(x,y_w) - \hat r_\theta(x,y_l).
\]
Then
\[
\ell(\theta) = -\log \sigma(z).
\]
Differentiate w.r.t. \(z\):
\[
\frac{d\ell}{dz}
  = -\frac{1}{\sigma(z)}\sigma'(z)
  = -\frac{1}{\sigma(z)}\sigma(z)\sigma(-z)
  = -\sigma(-z).
\]
But \(\sigma(-z) = 1 - \sigma(z)\), so
\[
\frac{d\ell}{dz}
  = \sigma(z) - 1
  = -\sigma(-z).
\]
Using the chain rule,
\[
\nabla_\theta \ell
  = \frac{d\ell}{dz}\,\nabla_\theta z
  = (\sigma(z) - 1)
    \Bigl(\nabla_\theta \hat r_\theta(x,y_w)
          - \nabla_\theta \hat r_\theta(x,y_l)\Bigr).
\]
We can equivalently rewrite this using \(\sigma(-z)\):
\[
\nabla_\theta \ell
  = \sigma(-z)\Bigl(
      \nabla_\theta \hat r_\theta(x,y_l)
      - \nabla_\theta \hat r_\theta(x,y_w)
    \Bigr),
\]
since \(\sigma(-z) = 1 - \sigma(z)\).

Recall \(\hat r_\theta(x,y) = \beta \log \pi_\theta(y\mid x) - \beta \log \pi_{\mathrm{ref}}(y\mid x)\), and \(\pi_{\mathrm{ref}}\) is fixed, so
\[
\nabla_\theta \hat r_\theta(x,y)
  = \beta \nabla_\theta \log \pi_\theta(y\mid x).
\]
Thus, for a single data point,
\[
\begin{aligned}
\nabla_\theta \ell
  &= \sigma\bigl(\hat r_\theta(x,y_l) - \hat r_\theta(x,y_w)\bigr)\,
     \beta\bigl(
       \nabla_\theta \log \pi_\theta(y_l\mid x)
       - \nabla_\theta \log \pi_\theta(y_w\mid x)
     \bigr) \\
  &= \beta\,\sigma\bigl(\hat r_\theta(x,y_l) - \hat r_\theta(x,y_w)\bigr)\,
     \Bigl(
       \nabla_\theta \log \pi_\theta(y_l\mid x)
       - \nabla_\theta \log \pi_\theta(y_w\mid x)
     \Bigr).
\end{aligned}
\]
Averaging over the dataset gives \(\nabla_\theta L_{\mathrm{DPO}}\).

**Interpretation of the weighting term \(\sigma(\hat r_\theta(x,y_l) - \hat r_\theta(x,y_w))\):**
- If the model is already **correct and confident**, then
  \(\hat r_\theta(x,y_w) \gg \hat r_\theta(x,y_l)\), so
  \(\hat r_\theta(x,y_l) - \hat r_\theta(x,y_w) \ll 0\) and
  \(\sigma(\hat r_\theta(x,y_l) - \hat r_\theta(x,y_w)) \approx 0\).
  The gradient is tiny: the model is barely updated.
- If the model is **wrong or uncertain**, then
  \(\hat r_\theta(x,y_l) \gtrsim \hat r_\theta(x,y_w)\), so the argument of \(\sigma(\cdot)\) is near or above zero, and the value of \(\sigma(\cdot)\) is moderate to large (around \(0.5\)–\(1\)).
  The gradient magnitude is large, strongly pushing \(\log \pi_\theta(y_w\mid x)\) up and \(\log \pi_\theta(y_l\mid x)\) down.

So the DPO gradient updates the model **more when it is incorrect or insufficiently confident**, and less when it already agrees with the human preference.

**Uncertainty note:** The sign manipulations and use of \(\sigma'(z)=\sigma(z)\sigma(-z)\) are a bit algebraic; I have double-checked that the final gradient pushes probability mass toward \(y_w\) and away from \(y_l\) when the model underestimates the preference for \(y_w\).

---

### (g) Plackett–Luce model and cancellation of \(Z(x)\)

The Plackett–Luce model for rankings \(\tau\) of \(K\) candidates \(\{y_1,\dots,y_K\}\) is
\[
p_{\theta^\*}(\tau\mid y_1,\dots,y_K,x)
  = \prod_{k=1}^K
    \frac{\exp\bigl(r_\phi(x,y_{\tau(k)})\bigr)}
         {\sum_{j=k}^K \exp\bigl(r_\phi(x,y_{\tau(j)})\bigr)}.
\]
Using the implicit reward parametrization from part (d),
\[
r_\phi(x,y)
  = \beta \log \frac{\pi_{\theta^\*}(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}
    + \beta \log Z(x).
\]
Then for any candidate \(y\),
\[
\exp\bigl(r_\phi(x,y)\bigr)
  = \exp\Bigl(
      \beta \log \frac{\pi_{\theta^\*}(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}
      + \beta \log Z(x)
    \Bigr)
  = Z(x)^\beta
    \left(\frac{\pi_{\theta^\*}(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}\right)^\beta.
\]
Plugging into the PL formula, each numerator becomes
\[
Z(x)^\beta
\left(\frac{\pi_{\theta^\*}(y_{\tau(k)}\mid x)}{\pi_{\mathrm{ref}}(y_{\tau(k)}\mid x)}\right)^\beta,
\]
and each denominator is
\[
\sum_{j=k}^K Z(x)^\beta
  \left(\frac{\pi_{\theta^\*}(y_{\tau(j)}\mid x)}{\pi_{\mathrm{ref}}(y_{\tau(j)}\mid x)}\right)^\beta
  = Z(x)^\beta
    \sum_{j=k}^K
      \left(\frac{\pi_{\theta^\*}(y_{\tau(j)}\mid x)}{\pi_{\mathrm{ref}}(y_{\tau(j)}\mid x)}\right)^\beta.
\]
Thus the factor \(Z(x)^\beta\) cancels in each fraction, giving
\[
p_{\theta^\*}(\tau\mid y_1,\dots,y_K,x)
  = \prod_{k=1}^K
    \frac{
      \left(\dfrac{\pi_{\theta^\*}(y_{\tau(k)}\mid x)}{\pi_{\mathrm{ref}}(y_{\tau(k)}\mid x)}\right)^\beta
    }{
      \sum_{j=k}^K
        \left(\dfrac{\pi_{\theta^\*}(y_{\tau(j)}\mid x)}{\pi_{\mathrm{ref}}(y_{\tau(j)}\mid x)}\right)^\beta
    }.
\]
This is the Plackett–Luce probability written solely in terms of \(\pi_{\theta^\*}\) and \(\pi_{\mathrm{ref}}\), with **no explicit dependence** on \(Z(x)\).

**Why is this desirable?**
- Just as in the pairwise BT case, we can now perform maximum-likelihood training of a parameterized policy \(\pi_\theta\) using observed rankings without ever computing \(Z(x)\).
- The objective depends only on **ratios** of probabilities under \(\pi_\theta\) and \(\pi_{\mathrm{ref}}\) for the finitely many candidates in each ranking, making learning tractable even when the full output space is huge.

**Uncertainty note:** The algebra is straightforward exponent/log manipulation; the main subtlety is confirming that \(Z(x)^\beta\) is the same factor for all candidates and hence cancels in each softmax-like term.


