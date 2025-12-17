## Summary

Writeup structure provided using an LLM, this includes formatting and points to talk about. However, the content and verification was done manually.

For this participation I used the modern LLM listed in `model.txt` (GPT 5.1) on the **non‑coding** parts of HW13, specifically Problems 1, 2, and 4. I then checked its written solutions in `problem1sol.md`, `problem2sol.md`, and `problem4sol.md` against the exact problem statements and against standard results from diffusion models and RLHF / DPO theory. Overall, the answers are mathematically correct and well‑reasoned, and I did not find any clear “classic” hallucinations like making up new definitions or theorems.

In terms of “one‑shot” performance, the model was able to give full multi‑step solutions for all subparts of Problems 1, 2, and 4 in a single pass. I did not have to correct any major algebra or logic. Most of my “checking work” was just verifying each step by hand, not fixing mistakes. So for this homework, the LLM basically solved the theory questions on its own, with only very minor approximation comments that I would clean up if I were writing it myself.

## Problem 1: DDPM/DDIM Fun – From a Gaussian

- **(a) and (b): marginal distributions**
  - The solution says \(X_t \sim \mathcal N(0,\sigma^2 + t)\), so \(X_1 \sim \mathcal N(0,\sigma^2+1)\), and similarly \(X_{t-\Delta t} \sim \mathcal N(0,\sigma^2 + t - \Delta t)\).
  - This exactly matches what you get by summing independent Gaussian noise of total variance \(t\), so this part is correct and standard, not a hallucination.

- **(c): approximate conditional variance**
  - The homework gives a conditional Gaussian formula for \(X_{t-\Delta t} \mid X_t\). The LLM takes the variance term \(\frac{(\sigma^2 + t - \Delta t)\,\Delta t}{\sigma^2 + t}\) and uses \(\Delta t \ll \sigma^2\) to approximate it as just \(\Delta t\).
  - This is a normal small‑step approximation: it’s literally expanding \((A-\Delta t)/A = 1 - \Delta t/A\) and throwing away the \(O(\Delta t^2)\) term. This is mathematically fine and matches how diffusion limits are usually derived.

- **(d): naïve reverse denoising using only the mean**
  - The solution multiplies by a deterministic factor at each reverse step, shows that the product telescopes, and gets an overall contraction factor \(C_{\text{naive}} = \frac{\sigma^2}{\sigma^2 + 1}\).
  - This telescoping product is correct: \(\prod_k \frac{\sigma^2 + (k-1)\Delta t}{\sigma^2 + k\Delta t} = \frac{\sigma^2}{\sigma^2+1}\).
  - From there it correctly concludes that \(\operatorname{Var}(\hat X_0)\) is roughly \(\sigma^4\), which is much smaller than the desired \(\sigma^2\). This matches the known fact that purely deterministic reverse diffusion over‑contracts the distribution.

- **(e): adding stochastic noise at each reverse step**
  - The given variance expression and the Riemann‑sum‑to‑integral limit are handled correctly.
  - I re‑did the integral \(\int_0^1 \left(\frac{\sigma^2}{\sigma^2 + t}\right)^2 dt\), and the LLM’s answer \(\sigma^2 - \frac{\sigma^4}{\sigma^2+1}\) is right.
  - When you combine that with the first term, the total variance is \(\sigma^2\) minus a tiny correction of order \(\sigma^6\). The solution just says “up to \(O(\sigma^4)\) terms,” which is slightly loose but directionally fine. This is nitpicking, not a conceptual error.

- **(f): training a neural net to approximate \(g(x_t, t)\)**
  - The setup (sample \(s \sim X_0\), sample \(t\), add \(\sqrt t\,\epsilon\), feed \((x_t,t)\) into a network, use MSE against the clean \(s\)) is exactly the standard DDPM style of training a denoiser / conditional mean estimator.
  - There is no made‑up objective here; it lines up with what you see in diffusion model papers and lecture notes.

- **(g): approximate DDIM step**
  - The solution uses the DDIM formula from the problem statement and approximates the coefficient \(\eta(t,\Delta t) = \frac{\sqrt t}{\sqrt{t-\Delta t}+\sqrt t}\) for small \(\Delta t\), ending up with roughly a factor of \(1/2\) and a step
    \[
    x^{\mathrm{DDIM}}_{t-\Delta t} \approx \left(1 - \frac{\Delta t}{2(\sigma^2 + t)}\right)x_t.
    \]
  - The algebraic approximation (Taylor expanding \(\sqrt{t-\Delta t}\)) is correct, and the exact form of \(\eta(t,\Delta t)\) matches the homework text, so there is no guesswork here.

- **(h): variance after all DDIM steps**
  - It treats each reverse step as multiplying by a factor \(r(t)\), turns the product into an exponential of an integral, and finds that \(\hat X_0 \sim \mathcal N\!\bigl(0,\,\frac{\sigma^2}{\sigma^2+1}\bigr)\), which is \(\approx \mathcal N(0,\sigma^2)\) when \(\sigma^2 \ll 1\).
  - This logic is correct and matches the idea that DDIM with the right scaling approximately recovers the target variance.

The reasoning is solid, the approximations are standard, and the only “iffy” part is interpreting the exact DDIM coefficient from a fuzzy PDF. I would not call this a real hallucination; it is more like a reasonable assumption in the face of messy formatting.

## Problem 2: Honey, Where’s My Reward Model?

- **(a): minimize \(D_{\mathrm{KL}}(p\|q)\)**
  - The solution just quotes Gibbs’ inequality and says the minimum is at \(p^\* = q\). That is exactly right and standard.

- **(b): optimal KL‑regularized policy**
  - It rewrites the objective into a form involving a KL divergence to a “Boltzmannized” distribution
    \(\tilde\pi(y\mid x) \propto \pi_{\mathrm{ref}}(y\mid x)\exp(r_\phi(x,y)/\beta)\).
  - The algebra is standard: factor out \(-\beta\), introduce a normalizing constant \(Z(x)\), and show that maximizing the objective is equivalent to minimizing a KL to \(\tilde\pi\).
  - The final answer
    \[
    \pi_\theta^\*(y\mid x) = \frac{1}{Z(x)} \pi_{\mathrm{ref}}(y\mid x)\exp\left(\frac{1}{\beta}r_\phi(x,y)\right)
    \]
    is exactly the usual result in the DPO and RLHF literature. No hallucination here.

- **(c): why \(\pi_\theta^\*\) is hard to use directly**
  - It correctly points out that \(Z(x)\) is a sum over all possible outputs \(y\), which is intractable for language models.
  - This is the standard reason this closed form is not directly used.

- **(d): express \(r_\phi\) in terms of \(\pi_\theta^\*\), \(\pi_{\mathrm{ref}}\), and \(Z(x)\)**
  - They take logs of the expression from (b) and solve for \(r_\phi\). The algebra checks out:
    \[
    r_\phi(x,y) = \beta \log \frac{\pi_\theta^\*(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)} + \beta \log Z(x).
    \]
  - This is exactly the implicit reward parametrization used in DPO.

- **(e): Bradley–Terry model and cancellation of \(Z(x)\)**
  - They plug the expression for \(r_\phi\) into the BT model \(p(y_w \succ y_l\mid x) = \sigma(r_\phi(x,y_w)-r_\phi(x,y_l))\).
  - The derivation correctly shows that the \(\beta\log Z(x)\) terms cancel, leaving only log‑ratios of \(\pi_\theta^\*/\pi_{\mathrm{ref}}\) for the two specific responses.
  - This matches how DPO avoids computing \(Z(x)\).

- **(f): gradient of the DPO loss**
  - They differentiate \(-\log \sigma(z)\) where \(z = \hat r_\theta(x,y_w)-\hat r_\theta(x,y_l)\), and then use the chain rule.
  - The final gradient expression, plus the interpretation (“updates are large when the model is wrong or unsure, and small when it already prefers \(y_w\) strongly”), matches the DPO paper and is correct.

- **(g): Plackett–Luce rankings and cancellation of \(Z(x)\)**
  - They start from the PL formula for rankings, plug in \(r_\phi\) expressed via \(\pi_{\theta^\*}/\pi_{\mathrm{ref}}\), and show that the common factor \(Z(x)^\beta\) cancels between numerator and denominator in each term.
  - The resulting expression depends only on probability ratios, which is exactly the point of using this form.

Everything lines up with the known DPO / BT / PL theory. The derivations are standard and consistent, and I did not see any hallucinated concepts or bogus formulas.

## Problem 4: Diffusion Models

- **(a): anytime sampling \(q(x_t\mid x_0)\)**
  - The solution proves by induction that
    \[
    q(x_t\mid x_0) = \mathcal N\!\bigl(x_t;\,\sqrt{\alpha_t}\,x_0,\,(1-\alpha_t)I\bigr),
    \]
    where \(\alpha_t = \prod_{s=1}^t (1-\beta_s)\).
  - The base case and the inductive step are both correct. The mean and variance calculations match exactly what you get from repeatedly applying linear‑Gaussian transitions.
  - This is the standard “closed form” used in all DDPM papers, so this part is clearly correct and not hallucinated.

- **(b): reverse conditional \(q(x_{t-1}\mid x_t,x_0)\)**
  - It multiplies two Gaussians in \(x_{t-1}\) (one from the forward kernel, one from the prior \(q(x_{t-1}\mid x_0)\)) and derives a Gaussian with a certain mean and variance.
  - The expression for the reverse variance
    \[
    \hat\beta_t = \frac{\beta_t(1-\alpha_{t-1})}{1-\alpha_t}
    \]
    is exactly the one used in DDPM derivations.
  - The mean
    \[
    \mu(x_t,x_0) = \frac{\sqrt{1-\beta_t}(1-\alpha_{t-1})}{1-\alpha_t}\,x_t
      + \frac{\sqrt{\alpha_{t-1}}\beta_t}{1-\alpha_t}\,x_0
    \]
    also matches the known formula.
  - The algebra for combining precisions and linear terms is correct.

The solution matches the canonical DDPM derivations. I don’t see hallucinations in the parts that are present.

## Observations about the LLM’s behavior, misconceptions, and hallucinations
  - For the three problems I checked, GPT 5.1 produced complete multi‑step solutions for all listed subparts in one shot.
  - I did not need follow‑up prompts to fix logic or to push it toward the right formulas. The work it produced is already acceptable as a final solution, maybe with tiny cosmetic edits.
  - It is very good at recalling standard results (e.g., DDPM closed forms, KL/Boltzmann derivations, DPO gradients) and then filling in missing algebra steps.
  - It keeps the notation consistent across a long derivation, and it tends to explain what it is doing, which makes it easier to audit.
  - It also sometimes adds short “uncertainty notes” where it flags an approximation or a possible ambiguity; this is actually helpful for spotting where I should double‑check.
  - I did not see any clear mathematical hallucinations (like totally wrong formulas or invented algorithms) in these solutions.
  - The only thing I would nitpick is a slightly loose statement about the order of small terms in Problem 1(e), but that is just approximate error bookkeeping, not a conceptual misunderstanding.
  - For this homework, GPT 5.1 basically behaves like a strong student who has already seen diffusion models and DPO before.
  - It one‑shots the questions, does the right algebra, and only makes very minor approximations that I would correct if I were polishing the writeup.
  - The main lesson for me is that for theory questions like these, the LLM can do almost all the work, but I still need to read carefully and verify each step instead of blindly trusting the output.


