# sanitizeHtml fixtures

Regression tests for `sanitizeHtml`, the HTML-email sanitizer in `sanitizeHtml.ts`. Each case here traces back to a specific moment where a real email broke it. Real content, lightly anonymized.

Each `###` heading is one case (`html` input, then `html` expected output). Expected-output blocks are generated -- run `bun run src/client/sanitizeHtml.fixtures.update.ts` after editing an input block or changing `sanitizeHtml.ts`, then review the diff.

## p/div break-count and inline-wrapper rules

### `<p><p>` = paragraph gap, `<div><div>` = line break

```txt
<p>First paragraph.</p><p>Second paragraph.</p><div>First line.</div><div>Second line.</div>
```

```txt
First paragraph.<br><br>Second paragraph.<br>First line.<br>Second line.
```

### `<font>` around block content adds no break of its own

```txt
<font face="arial"><div>Line one.</div><div>Line two.</div></font>
```

```txt
Line one.<br>Line two.
```

## Real emails

### handles nested `gmail_quote` wrappers (real Google Groups email)

The `<br>` run this collapses comes from unwrapping nested `gmail_quote`/`font`/`div` wrappers, not from `<br>`s already in the source.

```txt
<div dir="ltr"><span style="font-family:arial,sans-serif">Hi all,</span><br><div class="gmail_quote gmail_quote_container"><div class="msg3419142575980983521"><div dir="ltr"><div class="gmail_quote"><div dir="ltr"><div><font face="arial, sans-serif"><br></font></div><div><font face="arial, sans-serif">I&#39;m a volunteer for this year&#39;s apple harvest season, and thought to share the sign-up with the NYC Orchard Friends community! <br><br><b>Orchard Friends</b> is a group that helps people find, schedule, and enjoy volunteer picking days at local orchards. It's for anyone who loves fresh apples and a good afternoon outside. </font></div><div><font face="arial, sans-serif"><br>Orchard Friends is open to everyone, no experience needed —  whether you're picking for the first time, bringing your family, or a regular who's done this for years! <br><br>Sign up for the fall picking day by<b> Sunday, October 25, 2026! <span class="gmail_default" style="font-family:&quot;times new roman&quot;,serif"> </span></b></font><span style="font-family:arial,sans-serif">Learn more about the program and the endorsement process at </span><b style="font-family:arial,sans-serif"><a href="http://example.com" target="_blank">orchardvolunteerprogram.org</a>. </b><span style="font-family:arial,sans-serif">Reach out to </span><b style="font-family:arial,sans-serif"><a href="mailto:info@example.com" target="_blank">info@example.com</a></b><span style="font-family:arial,sans-serif"> with any questions! </span></div><div><font face="arial, sans-serif"><br>We also welcome help uplifting the app on social media:<br><br></font><ul style="margin-top:0px;margin-bottom:0px"><li style="margin-left:15px"><span style="color:rgb(0,0,0);font-family:Arial,sans-serif;white-space:pre-wrap">Instagram (</span><span style="font-family:Arial,sans-serif;white-space:pre-wrap;text-decoration-line:underline"><a href="http://example.com" target="_blank">here</a>)</span></li><li style="margin-left:15px"><span style="color:rgb(0,0,0);font-family:Arial,sans-serif;white-space:pre-wrap">LinkedIn (</span><span style="font-family:Arial,sans-serif;white-space:pre-wrap;text-decoration-line:underline"><a href="http://example.com" target="_blank">here</a>)</span></li></ul><br></div><div><div style="font-family:&quot;times new roman&quot;,serif">Thanks all! </div><div style="font-family:&quot;times new roman&quot;,serif">Jane</div></div></div></div></div></div></div><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature"><div dir="ltr"><p style="color:rgb(34,34,34);margin:0in 0in 0pt"><i style="color:rgb(0,0,0)"><b><font face="times new roman, serif">Jane Appleseed</font></b></i></p><div dir="ltr"><p class="MsoNormal" style="margin:0in;line-height:normal;font-family:Calibri,sans-serif;color:rgb(0,0,0)"><span style="font-family:&quot;Times New Roman&quot;,serif">Volunteer coordinator, Orchard Friends</span></p><div><p style="margin:0in 0in 0pt"><font face="times new roman, serif" color="#0b5394"><b><font>(555) 784 8287 </font>· <a href="http://example.com" target="_blank">LinkedIn</a></b><b> · <a href="http://example.com" target="_blank">janeappleseed.com</a> </b></font></p></div></div></div></div>

-- <br />
You received this message because you are subscribed to the Google Groups &quot;NYC Apple Pickers&quot; group.<br />
To unsubscribe from this group and stop receiving emails from it, send an email to <a href="mailto:applepicking+unsubscribe@googlegroups.com">applepicking+unsubscribe@googlegroups.com</a>.<br />
To view this discussion visit <a href="http://example.com">http://example.com</a>.<br />

```

```txt
Hi all,<br><br>I'm a volunteer for this year's apple harvest season, and thought to share the sign-up with the NYC Orchard Friends community! <br><br><b>Orchard Friends</b> is a group that helps people find, schedule, and enjoy volunteer picking days at local orchards. It's for anyone who loves fresh apples and a good afternoon outside. <br>Orchard Friends is open to everyone, no experience needed —  whether you're picking for the first time, bringing your family, or a regular who's done this for years! <br><br>Sign up for the fall picking day by<b> Sunday, October 25, 2026! </b>Learn more about the program and the endorsement process at <b><a href="http://example.com" target="_blank" rel="noopener noreferrer">orchardvolunteerprogram.org</a>. </b>Reach out to <b><a href="mailto:info@example.com" target="_blank" rel="noopener noreferrer">info@example.com</a></b> with any questions! <br>We also welcome help uplifting the app on social media:<br><ul><li>Instagram (<a href="http://example.com" target="_blank" rel="noopener noreferrer">here</a>)</li><li>LinkedIn (<a href="http://example.com" target="_blank" rel="noopener noreferrer">here</a>)</li></ul><br>Thanks all! <br>Jane<br>-- <br><br><i><b>Jane Appleseed</b></i><br>Volunteer coordinator, Orchard Friends<br><b>(555) 784 8287 · <a href="http://example.com" target="_blank" rel="noopener noreferrer">LinkedIn</a></b><b> · <a href="http://example.com" target="_blank" rel="noopener noreferrer">janeappleseed.com</a></b>

-- <br>
You received this message because you are subscribed to the Google Groups "NYC Apple Pickers" group.<br>
To unsubscribe from this group and stop receiving emails from it, send an email to <a href="mailto:applepicking+unsubscribe@googlegroups.com" target="_blank" rel="noopener noreferrer">applepicking+unsubscribe@googlegroups.com</a>.<br>
To view this discussion visit <a href="http://example.com" target="_blank" rel="noopener noreferrer">http://example.com</a>.
```

### handles nested layout tables (real web hosting company email)

Same as above: the stray `<br>`s trimmed here come from unwrapping table scaffolding, not from `<br>`s in the source.

```txt
<h2 style="margin: 0 0 20px; font-size: 19px; font-weight: 600; color: #1f2933;">Set it up now, ahead of the deadline</h2> <table role=presentation cellpadding=0 cellspacing=0 border=0 style="width: 100%;"> <tbody> <tr> <td style="padding-bottom: 14px;"> <table role=presentation cellpadding=0 cellspacing=0 border=0 style="width: 100%;"> <tbody> <tr> <td valign=top width=40> <table role=presentation cellpadding=0 cellspacing=0 border=0> <tbody> <tr> <td align=center valign=middle width=28 height=28 style="background-color: #e1f5ee; border-radius: 50%; font-size: 13px; font-weight: bold; color: #0f6e56;">1</td> </tr> </tbody> </table> </td> <td valign=middle style="padding-left: 2px;"> <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #3e4c59;">Log in to your Client Area</p> </td> </tr> </tbody> </table> </td> </tr> <tr> <td style="padding-bottom: 14px;"> <table role=presentation cellpadding=0 cellspacing=0 border=0 style="width: 100%;"> <tbody> <tr> <td valign=top width=40> <table role=presentation cellpadding=0 cellspacing=0 border=0> <tbody> <tr> <td align=center valign=middle width=28 height=28 style="background-color: #e1f5ee; border-radius: 50%; font-size: 13px; font-weight: bold; color: #0f6e56;">2</td> </tr> </tbody> </table> </td> <td valign=middle style="padding-left: 2px;"> <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #3e4c59;">Go to Security Settings</p> </td> </tr> </tbody> </table> </td> </tr> <tr> <td style="padding-bottom: 14px;"> <table role=presentation cellpadding=0 cellspacing=0 border=0 style="width: 100%;"> <tbody> <tr> <td valign=top width=40> <table role=presentation cellpadding=0 cellspacing=0 border=0> <tbody> <tr> <td align=center valign=middle width=28 height=28 style="background-color: #e1f5ee; border-radius: 50%; font-size: 13px; font-weight: bold; color: #0f6e56;">3</td> </tr> </tbody> </table> </td> <td valign=middle style="padding-left: 2px;"> <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #3e4c59;">Click on &ldquo;Enable now&rdquo;</p> </td> </tr> </tbody> </table> </td> </tr> <tr> <td style="padding-bottom: 0;"> <table role=presentation cellpadding=0 cellspacing=0 border=0 style="width: 100%;"> <tbody> <tr> <td valign=top width=40> <table role=presentation cellpadding=0 cellspacing=0 border=0> <tbody> <tr> <td align=center valign=middle width=28 height=28 style="background-color: #e1f5ee; border-radius: 50%; font-size: 13px; font-weight: bold; color: #0f6e56;">4</td> </tr> </tbody> </table> </td> <td valign=middle style="padding-left: 2px;"> <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #3e4c59;">Follow the prompts to link an authenticator app</p> </td> </tr> </tbody> </table> </td> </tr> </tbody> </table> <table role=presentation cellpadding=0 cellspacing=0 border=0> <tbody> <tr> <td style="background-color: #1f2933; border-radius: 8px;"><a href="http://example.com" style="display: inline-block; padding: 13px 26px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">Go to Security Settings &rarr;</a></td> </tr> </tbody> </table> <p style="margin: 16px 0 0; font-size: 14px; line-height: 1.7; color: #7b8794;">Handling it now means one less thing to think about later.</p>
```

```txt
Set it up now, ahead of the deadline <br><table><tr><td>1</td> <td>Log in to your Client Area</td></tr></table><br><br><table><tr><td>2</td> <td>Go to Security Settings</td></tr></table><br><br><table><tr><td>3</td> <td>Click on “Enable now”</td></tr></table><br><br><table><tr><td>4</td> <td>Follow the prompts to link an authenticator app</td></tr></table> <br><br><a href="http://example.com" target="_blank" rel="noopener noreferrer">Go to Security Settings →</a> <br><br>Handling it now means one less thing to think about later.
```

### drops empty tracking-pixel links (real credit card company email)

The "Not at all"/"Extremely" rating links are `<img>`-only anchors with no text -- dropped like any other empty link.

```txt
<p style="margin:0;"><span style="font-weight:400;font-size:16px;line-height:24px;">Hi there,<br><br>Your Netflix purchase was declined because you used a virtual card number (Spotify&#x2026;0000) created for Spotify. Each virtual card number is designed to work with only one merchant.</span></p>
<h2 style="margin:0; font-size:20px;">Declined purchase details</h2>
<p style="margin:0;"><span style="font-weight:400;font-size:16px;line-height:24px;">Netflix <br style="display:inline;" class="mblhide">Sept. 17, 2026</span></p>
<p style="margin:0;"><span style="font-weight:400;font-size:16px;line-height:24px;"><strong>If you recognize this purchase,</strong> use a virtual card number created for Netflix or your actual card number to retry the purchase, if needed.</span></p>
<ol style="margin: 0 0 0 24px; padding: 0;">
<li style="margin: 0 0 16px; padding: 0 0 0 4px;"><span>Using the Chrome browser on your desktop or mobile device, go to the Netflix website and select the option to pay with a virtual card.</span></li>
<li style="margin: 0; padding: 0 0 0 4px;"><span>Retry the purchase at Netflix using that virtual card number.</span></li>
</ol>
<h2 style="margin:0; font-size:20px;">Was this email relevant?</h2>
<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tbody><tr>
<td style="width:60px; text-align:left;">
<a href="http://example.com"><img src="http://example.com/image.png" width="40" height="40" border="0" alt="Not at all"></a>
</td><td style="width:80px; text-align:center;">
<a href="http://example.com"><img src="http://example.com/image.png" width="40" height="40" border="0" alt="Slightly"></a>
</td><td style="width:80px; text-align:center;">
<a href="http://example.com"><img src="http://example.com/image.png" width="40" height="40" border="0" alt="Moderately"></a>
</td><td style="width:80px; text-align:center;">
<a href="http://example.com"><img src="http://example.com/image.png" width="40" height="40" border="0" alt="Very"></a>
</td><td style="width:60px; text-align:right;">
<a href="http://example.com"><img src="http://example.com/image.png" width="40" height="40" border="0" alt="Extremely"></a>
</td></tr><tr><td colspan="5" style="padding-top:6px;" aria-hidden="true">
<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tbody><tr><td style="text-align:left;">
<p style="margin:0; white-space:nowrap;">Not at all</p>
</td><td style="text-align:right;">
<p style="margin:0; white-space:nowrap;">Extremely</p>
</td></tr></tbody></table>
</td></tr></tbody></table>
<img border="0" width="1" height="1" alt="" src="http://example.com">
```

```txt
Hi there,<br><br>Your Netflix purchase was declined because you used a virtual card number (Spotify…0000) created for Spotify. Each virtual card number is designed to work with only one merchant.
Declined purchase details
<br><br>Netflix <br>Sept. 17, 2026
<br><br><strong>If you recognize this purchase,</strong> use a virtual card number created for Netflix or your actual card number to retry the purchase, if needed.
<ol><li>Using the Chrome browser on your desktop or mobile device, go to the Netflix website and select the option to pay with a virtual card.</li>
<li>Retry the purchase at Netflix using that virtual card number.</li></ol>
Was this email relevant?
<br><table><tr><td>Not at all</td><td>Extremely</td></tr></table>
```

### caps `<br>` run at 1 next to a bare `<li>` (real Vercel email)

```txt
<p style="color:#171717;margin:0 0 16px 0;margin-top:0"></p><p style="color:#171717;margin:0 0 16px 0;"><strong style="color:#171717;font-weight:600">Your site is growing!</strong></p><p style="color:#171717;margin:0 0 16px 0;">
Your free
team
<strong style="color:#171717;font-weight:600">jappleseed</strong> has used 100% of the included free tier usage for <strong style="color:#171717;font-weight:600">Deployment Storage (10 GB)</strong>.</p><p style="color:#171717;margin:0 0 16px 0;"></p><p style="color:#171717;margin:0 0 16px 0;margin-bottom:0"></p><p style="color:#171717;margin:0 0 16px 0;margin-top:0"><strong style="color:#171717;font-weight:600">Managing your usage</strong></p><span style="margin-bottom:0"><li style="font-size:16px;line-height:1.75;color:#171717">
If this <a href="http://example.com" style="color:#0067D6;text-decoration:none">usage</a> is expected, congrats on your traffic!  </li><li style="font-size:16px;line-height:1.75;color:#171717">
If this <a href="http://example.com" style="color:#0067D6;text-decoration:none">usage</a> is <strong style="color:#171717;font-weight:600">not</strong> expected,  <a href="http://example.com" style="color:#0067D6;text-decoration:none">learn how to optimize</a> or <a href="http://example.com" style="color:#0067D6;text-decoration:none">delete your project</a>.


  </li></span>
```

```txt
<strong>Your site is growing!</strong><br><br>
Your free
team
<strong>jappleseed</strong> has used 100% of the included free tier usage for <strong>Deployment Storage (10 GB)</strong>.<br><br><strong>Managing your usage</strong><li>
If this <a href="http://example.com" target="_blank" rel="noopener noreferrer">usage</a> is expected, congrats on your traffic!  </li><li>
If this <a href="http://example.com" target="_blank" rel="noopener noreferrer">usage</a> is <strong>not</strong> expected,  <a href="http://example.com" target="_blank" rel="noopener noreferrer">learn how to optimize</a> or <a href="http://example.com" target="_blank" rel="noopener noreferrer">delete your project</a>.


  </li>
```

### KNOWN QUIRK: empty spacer `<p>` stacks an extra gap (real Spectrum email)

Not fixed -- locked in as current behavior. Each `<p>` (including the empty `<p class="ht-8">&nbsp;</p>` spacer) contributes its own gap independently.

```txt
<h3 class="blue-txt" valign="top">Your Account at a
    Glance</h3>
<p class="ht-8">&nbsp;</p>
<p><b>Account Number:</b></p>
<p>Ending in 0000</p>
<p class="ht-8">&nbsp;</p>
<p><b>Statement Amount:</b></p>
<p>$0.00</p>
<p class="ht-8">&nbsp;</p>
<p>
    <!----><b>Auto Pay Date:</b><!---->
</p>
<p>
    <!---->September 24, 2026<!---->
</p>
```

```txt
Your Account at a
    Glance
<br><br><b>Account Number:</b>
<br><br>Ending in 0000
<br><br><b>Statement Amount:</b>
<br><br>$0.00
<br><br><b>Auto Pay Date:</b>
<br><br>September 24, 2026
```
